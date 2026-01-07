import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { createEntitySchema, updateEntitySchema } from '@/lib/schemas';

export const entitiesRouter = createTRPCRouter({
  // List all entities
  list: protectedProcedure
    .input(
      z.object({
        type: z.enum(['PERSON', 'BUSINESS', 'PROJECT']).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const entities = await ctx.db.entity.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.type && { type: input.type }),
        },
        include: {
          financialAccounts: {
            select: { id: true, name: true, type: true, currentBalance: true },
          },
          _count: {
            select: {
              transactionsAsPayer: true,
              transactionsAsIncurred: true,
            },
          },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return entities;
    }),

  // Get single entity
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const entity = await ctx.db.entity.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          financialAccounts: true,
        },
      });
      return entity;
    }),

  // Create entity
  create: protectedProcedure
    .input(createEntitySchema)
    .mutation(async ({ ctx, input }) => {
      // If setting as default, unset other defaults of same type
      if (input.isDefault) {
        await ctx.db.entity.updateMany({
          where: { userId: ctx.session.user.id, type: input.type },
          data: { isDefault: false },
        });
      }

      const entity = await ctx.db.entity.create({
        data: {
          userId: ctx.session.user.id,
          type: input.type,
          name: input.name,
          description: input.description,
          isDefault: input.isDefault ?? false,
        },
      });
      return entity;
    }),

  // Update entity
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateEntitySchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.entity.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Entity not found');

      const entity = await ctx.db.entity.update({
        where: { id: input.id },
        data: input.data,
      });
      return entity;
    }),

  // Delete entity
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.entity.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Entity not found');

      // Unassign transactions and accounts first
      await ctx.db.transaction.updateMany({
        where: { payerId: input.id },
        data: { payerId: null },
      });
      await ctx.db.transaction.updateMany({
        where: { incurredById: input.id },
        data: { incurredById: null },
      });
      await ctx.db.financialAccount.updateMany({
        where: { entityId: input.id },
        data: { entityId: null },
      });

      await ctx.db.entity.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),

  // Get spending summary by entity
  spendingSummary: protectedProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const entities = await ctx.db.entity.findMany({
        where: { userId: ctx.session.user.id },
        include: {
          transactionsAsIncurred: {
            where: {
              type: 'EXPENSE',
              date: {
                gte: input?.startDate ?? startOfMonth,
                lte: input?.endDate ?? endOfMonth,
              },
            },
            select: { amount: true },
          },
        },
      });

      return entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        totalSpend: entity.transactionsAsIncurred.reduce(
          (sum, t) => sum + Math.abs(Number(t.amount)),
          0
        ),
        transactionCount: entity.transactionsAsIncurred.length,
      }));
    }),
});
