import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

const splitItemSchema = z.object({
  amount: z.number(),
  categoryId: z.string().optional(),
  classification: z
    .enum([
      'COGS',
      'OPERATING',
      'PERSONAL',
      'INCOME',
      'TRANSFER',
      'REIMBURSABLE',
      'REIMBURSEMENT',
    ])
    .optional(),
  incurredById: z.string().optional(),
  description: z.string().optional(),
});

export const splitsRouter = createTRPCRouter({
  // Get splits for a transaction
  getByTransactionId: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
        select: { id: true, amount: true },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      const splits = await ctx.db.transactionSplit.findMany({
        where: { transactionId: input.transactionId },
        include: {
          category: {
            select: { id: true, name: true, icon: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return {
        transactionAmount: transaction.amount,
        splits,
      };
    }),

  // Create or replace splits for a transaction
  save: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        splits: z.array(splitItemSchema).min(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
        select: { id: true, amount: true },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      // Validate that split amounts sum to the transaction amount
      const totalSplit = input.splits.reduce((sum, s) => sum + s.amount, 0);
      const txAmount = Math.abs(Number(transaction.amount));
      const tolerance = 0.01;

      if (Math.abs(totalSplit - txAmount) > tolerance) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Split amounts (${totalSplit.toFixed(2)}) must equal the transaction amount (${txAmount.toFixed(2)})`,
        });
      }

      // Delete existing splits and create new ones in a transaction
      const result = await ctx.db.$transaction(async (tx) => {
        await tx.transactionSplit.deleteMany({
          where: { transactionId: input.transactionId },
        });

        const splits = await Promise.all(
          input.splits.map((split) =>
            tx.transactionSplit.create({
              data: {
                transactionId: input.transactionId,
                amount: split.amount,
                categoryId: split.categoryId || null,
                classification: split.classification as any || null,
                incurredById: split.incurredById || null,
                description: split.description || null,
              },
              include: {
                category: {
                  select: { id: true, name: true, icon: true },
                },
              },
            })
          )
        );

        return splits;
      });

      return result;
    }),

  // Remove all splits from a transaction
  remove: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      await ctx.db.transactionSplit.deleteMany({
        where: { transactionId: input.transactionId },
      });

      return { success: true };
    }),
});
