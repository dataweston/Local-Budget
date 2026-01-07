import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  createTransactionSchema,
  updateTransactionSchema,
  transactionFiltersSchema,
} from '@/lib/schemas';
import { Prisma } from '@prisma/client';

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
        where.AND = [
          {
            OR: [
              { description: { contains: input.search, mode: 'insensitive' } },
              { merchantName: { contains: input.search, mode: 'insensitive' } },
              { userDescription: { contains: input.search, mode: 'insensitive' } },
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
          classification: input.classification,
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

      const transaction = await ctx.db.transaction.update({
        where: { id: input.id },
        data: input.data,
      });
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
        categoryId: z.string().optional(),
        classification: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership of all transactions
      const owned = await ctx.db.transaction.count({
        where: {
          id: { in: input.transactionIds },
          account: { userId: ctx.session.user.id },
        },
      });
      if (owned !== input.transactionIds.length) {
        throw new Error('Some transactions not found');
      }

      await ctx.db.transaction.updateMany({
        where: { id: { in: input.transactionIds } },
        data: {
          ...(input.categoryId && { categoryId: input.categoryId }),
          ...(input.classification && { classification: input.classification as any }),
          isReviewed: true,
        },
      });
      return { success: true, count: input.transactionIds.length };
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
