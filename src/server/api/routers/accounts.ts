import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  createAccountSchema,
  updateAccountSchema,
} from '@/lib/schemas';
import { recordFinancialAudit } from '@/lib/financial-integrity';

export const accountsRouter = createTRPCRouter({
  // Get all accounts for the current user
  list: protectedProcedure
    .input(
      z.object({
        entityId: z.string().optional(),
        type: z.string().optional(),
        isActive: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const accounts = await ctx.db.financialAccount.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.entityId && { entityId: input.entityId }),
          ...(input?.type && { type: input.type as any }),
          ...(input?.isActive !== undefined && { isActive: input.isActive }),
        },
        include: {
          entity: true,
          _count: {
            select: { transactions: true },
          },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      return accounts;
    }),

  // Get a single account by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await ctx.db.financialAccount.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          entity: true,
          transactions: {
            take: 10,
            orderBy: { date: 'desc' },
          },
        },
      });
      return account;
    }),

  // Create a new account
  create: protectedProcedure
    .input(createAccountSchema)
    .mutation(async ({ ctx, input }) => {
      const account = await ctx.db.financialAccount.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          type: input.type,
          entityId: input.entityId,
          institution: input.institution,
          accountNumber: input.accountNumber,
          currentBalance: input.currentBalance,
          currency: input.currency,
          isInternal: input.isInternal,
        },
      });
      return account;
    }),

  // Update an account
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateAccountSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.financialAccount.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Account not found');

      const account = await ctx.db.financialAccount.update({
        where: { id: input.id },
        data: input.data,
      });
      return account;
    }),

  // Deactivate an account without destroying its financial history.
  deactivate: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        reason: z.string().min(1).max(1000).default('Account deactivated'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.financialAccount.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Account not found');

      return ctx.db.$transaction(async (tx) => {
        const account = await tx.financialAccount.update({
          where: { id: input.id },
          data: { isActive: false },
        });
        await recordFinancialAudit(tx, {
          userId: ctx.session.user.id,
          actorUserId: ctx.session.user.id,
          financialAccountId: account.id,
          action: 'ACCOUNT_DEACTIVATED',
          source: 'MANUAL',
          reason: input.reason,
          changedFields: ['isActive'],
          before: { isActive: existing.isActive },
          after: { isActive: false },
        });
        return { success: true, account };
      });
    }),

  // Get account balances summary
  balances: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.db.financialAccount.findMany({
      where: { userId: ctx.session.user.id, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        currentBalance: true,
        currency: true,
        updatedAt: true,
        entity: {
          select: { name: true },
        },
      },
    });

    const totalBalance = accounts.reduce(
      (sum, acc) => sum + Number(acc.currentBalance),
      0
    );

    return {
      accounts,
      totalBalance,
    };
  }),
});
