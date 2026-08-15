import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  createTransactionSchema,
  updateTransactionSchema,
  transactionFiltersSchema,
  classificationTypeEnum,
} from '@/lib/schemas';
import { TRPCError } from '@trpc/server';
import { Prisma, type ClassificationType } from '@prisma/client';
import { looksLikeMisclassifiedRevenue } from '@/lib/reclassify';
import {
  partitionProcessorLedger,
  processorLedgerAccountIds,
  PROCESSOR_LEDGER_REASON,
} from '@/lib/processor-ledger';
import { recordCategoryFeedback } from '@/lib/ml/feedback';
import {
  changedFinancialFields,
  recordFinancialAudit,
  transactionBalanceEffect,
} from '@/lib/financial-integrity';

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
      if (input?.reconciliationStatus) {
        where.reconciliationStatus = input.reconciliationStatus;
      }

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
          sourceIdentities: { orderBy: { firstSeenAt: 'asc' } },
          allocations: { orderBy: { acceptedAt: 'asc' } },
          auditEvents: { orderBy: { createdAt: 'desc' }, take: 100 },
          settlement: { include: { entries: true } },
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

      return ctx.db.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
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
              input.classification ?? categoryDefaultClassification ?? undefined,
            payerId: input.payerId,
            incurredById: input.incurredById,
            notes: input.notes,
          },
        });

        const balanceChange = transactionBalanceEffect(transaction);
        if (balanceChange !== 0) {
          await tx.financialAccount.update({
            where: { id: input.accountId },
            data: { currentBalance: { increment: balanceChange } },
          });
        }
        await recordFinancialAudit(tx, {
          userId: ctx.session.user.id,
          actorUserId: ctx.session.user.id,
          transactionId: transaction.id,
          financialAccountId: input.accountId,
          action: 'TRANSACTION_CREATED',
          source: 'MANUAL',
          reason: 'Manual transaction creation',
          changedFields: [
            'accountId',
            'amount',
            'type',
            'status',
            'date',
            'description',
            'merchantName',
            'categoryId',
            'classification',
            'payerId',
            'incurredById',
            'notes',
          ],
          after: transaction,
        });
        return transaction;
      });
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

      const { reconciliationReason, ...data } = input.data;

      // When the category is being changed (including unassigned), keep the
      // classification in sync with the new category's default unless the
      // caller explicitly provided a classification of their own.
      //
      // A classification that differs from the OLD category's default was set
      // deliberately on this transaction (business vs personal is a per-row
      // decision — a work vehicle payment sits in a personal category, a
      // personal charge sits in a business one). Recategorizing must not
      // silently discard that; only an inherited value is re-inherited.
      if ('categoryId' in data && !('classification' in data)) {
        const previousCategory = existing.categoryId
          ? await ctx.db.category.findFirst({
              where: { id: existing.categoryId, userId: ctx.session.user.id },
              select: { defaultClassification: true },
            })
          : null;
        const wasInherited =
          existing.classification === null ||
          existing.classification === previousCategory?.defaultClassification;

        if (wasInherited) {
          if (data.categoryId) {
            const category = await ctx.db.category.findFirst({
              where: { id: data.categoryId, userId: ctx.session.user.id },
              select: { defaultClassification: true },
            });
            if (!category) throw new Error('Category not found');
            data.classification = category.defaultClassification ?? null;
          } else {
            data.classification = null;
          }
        } else if (data.categoryId) {
          // Still validate the target category belongs to the user.
          const category = await ctx.db.category.findFirst({
            where: { id: data.categoryId, userId: ctx.session.user.id },
            select: { id: true },
          });
          if (!category) throw new Error('Category not found');
        }
      }

      if (data.accountId && data.accountId !== existing.accountId) {
        const targetAccount = await ctx.db.financialAccount.findFirst({
          where: { id: data.accountId, userId: ctx.session.user.id },
          select: { id: true },
        });
        if (!targetAccount) throw new Error('Target account not found');
      }
      if (data.reconciliationStatus) {
        const reconciliationData = data as Prisma.TransactionUncheckedUpdateInput;
        if (data.reconciliationStatus === 'MATCHED') {
          reconciliationData.reconciliationMethod =
            data.reconciliationMethod ?? 'MANUAL';
          reconciliationData.reconciledAt = new Date();
        } else {
          reconciliationData.reconciledAt = null;
        }
      }

      return ctx.db.$transaction(async (tx) => {
        const transaction = await tx.transaction.update({
          where: { id: input.id },
          data,
        });

        const beforeEffect = transactionBalanceEffect(existing);
        const afterEffect = transactionBalanceEffect(transaction);
        if (existing.accountId === transaction.accountId) {
          const delta = afterEffect - beforeEffect;
          if (delta !== 0) {
            await tx.financialAccount.update({
              where: { id: transaction.accountId },
              data: { currentBalance: { increment: delta } },
            });
          }
        } else {
          if (beforeEffect !== 0) {
            await tx.financialAccount.update({
              where: { id: existing.accountId },
              data: { currentBalance: { increment: -beforeEffect } },
            });
          }
          if (afterEffect !== 0) {
            await tx.financialAccount.update({
              where: { id: transaction.accountId },
              data: { currentBalance: { increment: afterEffect } },
            });
          }
        }

        const auditedFields = changedFinancialFields(
          existing as unknown as Record<string, unknown>,
          transaction as unknown as Record<string, unknown>,
          [
            'accountId',
            'amount',
            'type',
            'status',
            'date',
            'description',
            'merchantName',
            'categoryId',
            'classification',
            'payerId',
            'incurredById',
            'notes',
            'userDescription',
            'isReviewed',
            'reconciliationStatus',
            'reconciliationMethod',
            'reconciledAt',
          ]
        );
        await recordFinancialAudit(tx, {
          userId: ctx.session.user.id,
          actorUserId: ctx.session.user.id,
          transactionId: transaction.id,
          financialAccountId: transaction.accountId,
          action: 'TRANSACTION_UPDATED',
          source: 'MANUAL',
          reason: reconciliationReason ?? 'Manual transaction update',
          changedFields: auditedFields,
          before: existing,
          after: transaction,
        });

        if ('categoryId' in input.data && data.categoryId) {
          await recordCategoryFeedback(tx, {
            userId: ctx.session.user.id,
            merchantName: existing.merchantName,
            description: existing.description,
            type: existing.type,
            categoryId: data.categoryId,
            wasCorrection: existing.categoryId !== data.categoryId,
          });
        }
        return transaction;
      });
    }),

  // Void a transaction while preserving its audit and provider history.
  void: protectedProcedure
    .input(z.object({ id: z.string(), reason: z.string().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.transaction.findFirst({
        where: {
          id: input.id,
          account: { userId: ctx.session.user.id },
        },
      });
      if (!existing) throw new Error('Transaction not found');

      return ctx.db.$transaction(async (tx) => {
        const transaction = await tx.transaction.update({
          where: { id: input.id },
          data: { status: 'CANCELLED' },
        });
        const previousEffect = transactionBalanceEffect(existing);
        if (previousEffect !== 0) {
          await tx.financialAccount.update({
            where: { id: existing.accountId },
            data: { currentBalance: { increment: -previousEffect } },
          });
        }
        await recordFinancialAudit(tx, {
          userId: ctx.session.user.id,
          actorUserId: ctx.session.user.id,
          transactionId: transaction.id,
          financialAccountId: transaction.accountId,
          action: 'TRANSACTION_VOIDED',
          source: 'MANUAL',
          reason: input.reason,
          changedFields: ['status'],
          before: existing,
          after: transaction,
        });
        return { success: true, transaction };
      });
    }),

  // Bulk categorize
  bulkCategorize: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()),
        categoryId: z.string().nullable().optional(),
        classification: classificationTypeEnum.nullable().optional(),
        reason: z.string().min(1).max(1000).default('Bulk categorization'),
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
          classification: true,
          isReviewed: true,
          accountId: true,
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

      // Refuse to classify processor-ledger rows in bulk. Silently skipping
      // them would be its own surprise — the caller selected these — so name
      // the rows and let them narrow the selection.
      if (classificationToApply !== undefined && classificationToApply !== null) {
        const { protected: guarded } = partitionProcessorLedger(
          owned,
          await processorLedgerAccountIds(ctx.db, ctx.session.user.id)
        );
        if (guarded.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              `${guarded.length} of ${owned.length} selected transactions cannot be ` +
              `classified. ${PROCESSOR_LEDGER_REASON}`,
          });
        }
      }

      const bulkUpdateData: Prisma.TransactionUncheckedUpdateManyInput = {
        isReviewed: !(classificationToApply === null && !input.categoryId),
      };
      if (input.categoryId !== undefined) bulkUpdateData.categoryId = input.categoryId;
      if (classificationToApply !== undefined) {
        bulkUpdateData.classification = classificationToApply;
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { id: { in: input.transactionIds } },
          data: bulkUpdateData,
        });
        for (const existing of owned) {
          const after = {
            ...existing,
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
            ...(classificationToApply !== undefined
              ? { classification: classificationToApply }
              : {}),
            isReviewed: bulkUpdateData.isReviewed,
          };
          await recordFinancialAudit(tx, {
            userId: ctx.session.user.id,
            actorUserId: ctx.session.user.id,
            transactionId: existing.id,
            financialAccountId: existing.accountId,
            action: 'TRANSACTION_BULK_CLASSIFIED',
            source: 'MANUAL',
            reason: input.reason,
            changedFields: changedFinancialFields(
              existing as unknown as Record<string, unknown>,
              after as unknown as Record<string, unknown>,
              ['categoryId', 'classification', 'isReviewed']
            ),
            before: existing,
            after,
          });
          if (input.categoryId) {
            await recordCategoryFeedback(tx, {
              userId: ctx.session.user.id,
              merchantName: existing.merchantName,
              description: existing.description,
              type: existing.type,
              categoryId: input.categoryId,
              wasCorrection: existing.categoryId !== input.categoryId,
            });
          }
        }
      });
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
