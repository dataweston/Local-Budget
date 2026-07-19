import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  createTransactionSchema,
  updateTransactionSchema,
  transactionFiltersSchema,
  classificationTypeEnum,
} from '@/lib/schemas';
import { Prisma, type ClassificationType } from '@prisma/client';
import { looksLikeMisclassifiedRevenue } from '@/lib/reclassify';
import { recordCategoryFeedback } from '@/lib/ml/feedback';

export const transactionsRouter = createTRPCRouter({
  // List transactions with filters
  list: protectedProcedure
    .input(transactionFiltersSchema.optional())
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const skip = (page - 1) * limit;

      const where: Prisma.TransactionWhereInput = {
        account: { userId: ctx.session.user.id },
      };

      if (input?.accountId) where.accountId = input.accountId;
      if (input?.categoryId) where.categoryId = input.categoryId;
      if (input?.classification) where.classification = input.classification;
      if (input?.type) where.type = input.type;
      if (input?.status) where.status = input.status;
      if (input?.isReviewed !== undefined) where.isReviewed = input.isReviewed;
      if (input?.isReconciled !== undefined) where.isReconciled = input.isReconciled;

      if (input?.entityId) {
        where.OR = [
          { payerId: input.entityId },
          { incurredById: input.entityId },
        ];
      }

      if (input?.startDate || input?.endDate) {
        where.date = {};
        if (input.startDate) where.date.gte = input.startDate;
        if (input.endDate) where.date.lte = input.endDate;
      }

      if (input?.minAmount !== undefined || input?.maxAmount !== undefined) {
        where.amount = {};
        if (input.minAmount !== undefined) where.amount.gte = input.minAmount;
        if (input.maxAmount !== undefined) where.amount.lte = input.maxAmount;
      }

      if (input?.search) {
        const q = input.search.trim();
        where.AND = [
          {
            OR: [
              { description: { contains: q, mode: 'insensitive' } },
              { merchantName: { contains: q, mode: 'insensitive' } },
              { userDescription: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } },
              {
                lineItems: {
                  some: {
                    description: { contains: q, mode: 'insensitive' },
                  },
                },
              },
              {
                receiptLinks: {
                  some: {
                    receipt: {
                      OR: [
                        { vendorName: { contains: q, mode: 'insensitive' } },
                        { rawOcrText: { contains: q, mode: 'insensitive' } },
                        {
                          lineItems: {
                            some: {
                              description: { contains: q, mode: 'insensitive' },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        ];
      }

      const [transactions, total] = await Promise.all([
        ctx.db.transaction.findMany({
          where,
          include: {
            account: { select: { id: true, name: true, type: true } },
            category: { select: { id: true, name: true, icon: true } },
            payer: { select: { id: true, name: true, type: true } },
            incurredBy: { select: { id: true, name: true, type: true } },
            receiptLinks: {
              include: {
                receipt: {
                  select: { id: true, fileName: true, status: true },
                },
              },
            },
          },
          orderBy: { date: 'desc' },
          skip,
          take: limit,
        }),
        ctx.db.transaction.count({ where }),
      ]);

      return {
        data: transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }),

  // Get single transaction by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const transaction = await ctx.db.transaction.findFirst({
        where: { 
          id: input.id,
          account: { userId: ctx.session.user.id },
        },
        include: {
          account: true,
          category: true,
          payer: true,
          incurredBy: true,
          lineItems: true,
          receiptLinks: {
            include: { receipt: true },
          },
          linkedFrom: {
            include: { toTransaction: true },
          },
          linkedTo: {
            include: { fromTransaction: true },
          },
          splits: {
            include: { category: true },
          },
        },
      });
      return transaction;
    }),

  // Create transaction
  create: protectedProcedure
    .input(createTransactionSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify account ownership
      const account = await ctx.db.financialAccount.findFirst({
        where: { id: input.accountId, userId: ctx.session.user.id },
      });
      if (!account) throw new Error('Account not found');

      let categoryDefaultClassification: ClassificationType | null = null;
      if (input.categoryId) {
        const category = await ctx.db.category.findFirst({
          where: {
            id: input.categoryId,
            userId: ctx.session.user.id,
          },
          select: { defaultClassification: true },
        });
        if (!category) throw new Error('Category not found');
        categoryDefaultClassification = category.defaultClassification;
      }

      const transaction = await ctx.db.transaction.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          type: input.type,
          status: input.status,
          date: input.date,
          description: input.description,
          merchantName: input.merchantName,
          categoryId: input.categoryId,
          classification:
            input.classification ?? (categoryDefaultClassification as any) ?? undefined,
          payerId: input.payerId,
          incurredById: input.incurredById,
          notes: input.notes,
        },
      });

      // Update account balance
      const balanceChange = input.type === 'EXPENSE' ? -Math.abs(Number(input.amount)) : Number(input.amount);
      await ctx.db.financialAccount.update({
        where: { id: input.accountId },
        data: {
          currentBalance: {
            increment: balanceChange,
          },
        },
      });

      return transaction;
    }),

  // Update transaction
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateTransactionSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.transaction.findFirst({
        where: { 
          id: input.id,
          account: { userId: ctx.session.user.id },
        },
      });
      if (!existing) throw new Error('Transaction not found');

      const data = { ...input.data };

      // When the category is being changed (including unassigned), keep the
      // classification in sync with the new category's default unless the
      // caller explicitly provided a classification of their own.
      if ('categoryId' in data && !('classification' in data)) {
        if (data.categoryId) {
          const category = await ctx.db.category.findFirst({
            where: { id: data.categoryId, userId: ctx.session.user.id },
            select: { defaultClassification: true },
          });
          if (!category) throw new Error('Category not found');
          if (category.defaultClassification) {
            data.classification = category.defaultClassification;
          }
        } else {
          data.classification = null;
        }
      }

      const transaction = await ctx.db.transaction.update({
        where: { id: input.id },
        data,
      });

      // A manual category choice is durable training data. This is especially
      // useful for Venmo, where the counterparty is now the merchant identity:
      // the next payment to the same person/business can be suggested correctly.
      if ('categoryId' in input.data && data.categoryId) {
        await recordCategoryFeedback(ctx.db, {
          userId: ctx.session.user.id,
          merchantName: existing.merchantName,
          description: existing.description,
          type: existing.type,
          categoryId: data.categoryId,
          wasCorrection: existing.categoryId !== data.categoryId,
        });
      }
      return transaction;
    }),

  // Delete transaction
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const transaction = await ctx.db.transaction.findFirst({
        where: { 
          id: input.id,
          account: { userId: ctx.session.user.id },
        },
        select: { amount: true, accountId: true, type: true },
      });

      if (!transaction) throw new Error('Transaction not found');

      // Revert the balance change
      const balanceRevert = transaction.type === 'EXPENSE' 
        ? Math.abs(Number(transaction.amount)) 
        : -Number(transaction.amount);
      
      await ctx.db.financialAccount.update({
        where: { id: transaction.accountId },
        data: {
          currentBalance: {
            increment: balanceRevert,
          },
        },
      });

      await ctx.db.transaction.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  // Bulk categorize
  bulkCategorize: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()),
        categoryId: z.string().nullable().optional(),
        classification: classificationTypeEnum.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership of all transactions
      const owned = await ctx.db.transaction.findMany({
        where: {
          id: { in: input.transactionIds },
          account: { userId: ctx.session.user.id },
        },
        select: {
          id: true,
          categoryId: true,
          merchantName: true,
          description: true,
          type: true,
        },
      });
      if (owned.length !== input.transactionIds.length) {
        throw new Error('Some transactions not found');
      }

      let categoryDefaultClassification: ClassificationType | null = null;
      if (input.categoryId) {
        const category = await ctx.db.category.findFirst({
          where: {
            id: input.categoryId,
            userId: ctx.session.user.id,
          },
          select: { defaultClassification: true },
        });
        if (!category) {
          throw new Error('Category not found');
        }
        categoryDefaultClassification = category.defaultClassification;
      }

      const classificationToApply =
        input.classification !== undefined
          ? input.classification
          : input.categoryId !== undefined
            ? categoryDefaultClassification
            : undefined;

      const bulkUpdateData: Prisma.TransactionUncheckedUpdateManyInput = {
        isReviewed: !(classificationToApply === null && !input.categoryId),
      };
      if (input.categoryId !== undefined) bulkUpdateData.categoryId = input.categoryId;
      if (classificationToApply !== undefined) {
        bulkUpdateData.classification = classificationToApply;
      }

      await ctx.db.transaction.updateMany({
        where: { id: { in: input.transactionIds } },
        data: bulkUpdateData,
      });

      if (input.categoryId) {
        await Promise.all(
          owned.map((tx) =>
            recordCategoryFeedback(ctx.db, {
              userId: ctx.session.user.id,
              merchantName: tx.merchantName,
              description: tx.description,
              type: tx.type,
              categoryId: input.categoryId!,
              wasCorrection: tx.categoryId !== input.categoryId,
            })
          )
        );
      }
      return { success: true, count: input.transactionIds.length };
    }),

  // Retroactive revenue recovery: INCOME transactions classified TRANSFER that
  // look like real revenue (customer/processor payments), not internal moves.
  // These were excluded from the P&L by the bug the rules.ts INCOME/TRANSFER
  // guard now prevents. Surfaced for review; the UI clears the TRANSFER
  // classification via bulkCategorize (classification falls back to revenue).
  misclassifiedRevenue: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(1000).default(500) }).optional())
    .query(async ({ ctx, input }) => {
      const candidates = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          type: 'INCOME',
          classification: 'TRANSFER',
        },
        select: {
          id: true,
          date: true,
          amount: true,
          type: true,
          classification: true,
          merchantName: true,
          description: true,
          account: { select: { id: true, name: true } },
        },
        orderBy: { amount: 'desc' },
      });

      const suspects = candidates.filter(looksLikeMisclassifiedRevenue);
      const limited = suspects.slice(0, input?.limit ?? 500);

      return {
        transactions: limited,
        totalMarkedTransfer: candidates.length,
        suspectCount: suspects.length,
        suspectAmount: Number(
          suspects.reduce((sum, t) => sum + Number(t.amount), 0).toFixed(2)
        ),
      };
    }),

  // Retroactive revenue recovery action: clear the TRANSFER classification on
  // confirmed-revenue rows so getEffectiveClassification falls back to revenue
  // (INCOME). Re-validates server-side that each target really is INCOME+TRANSFER
  // — a stale client must not be able to wipe classification off other rows.
  clearTransferClassification: protectedProcedure
    .input(z.object({ transactionIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const eligible = await ctx.db.transaction.findMany({
        where: {
          id: { in: input.transactionIds },
          account: { userId: ctx.session.user.id },
          type: 'INCOME',
          classification: 'TRANSFER',
        },
        select: { id: true },
      });

      if (eligible.length === 0) return { cleared: 0 };

      const result = await ctx.db.transaction.updateMany({
        where: { id: { in: eligible.map((t) => t.id) } },
        data: { classification: null, isReviewed: true },
      });
      return { cleared: result.count };
    }),

  // Mark as reviewed
  markReviewed: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()),
        isReviewed: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction.updateMany({
        where: { 
          id: { in: input.transactionIds },
          account: { userId: ctx.session.user.id },
        },
        data: { isReviewed: input.isReviewed },
      });
      return { success: true };
    }),

  // Get unreviewed count
  unreviewedCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await ctx.db.transaction.count({
      where: { 
        isReviewed: false,
        account: { userId: ctx.session.user.id },
      },
    });
    return count;
  }),

  // Recent transactions for dashboard
  recent: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const transactions = await ctx.db.transaction.findMany({
        where: { account: { userId: ctx.session.user.id } },
        take: input?.limit ?? 10,
        orderBy: { date: 'desc' },
        include: {
          account: { select: { name: true } },
          category: { select: { name: true, icon: true } },
        },
      });
      return transactions;
    }),
});
