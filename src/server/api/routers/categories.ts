import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { createCategorySchema, updateCategorySchema } from '@/lib/schemas';

export const categoriesRouter = createTRPCRouter({
  // List all categories
  list: protectedProcedure
    .input(
      z.object({
        includeSystem: z.boolean().default(true),
        parentId: z.string().nullable().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const categories = await ctx.db.category.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.includeSystem === false && { isSystem: false }),
          ...(input?.parentId !== undefined && { parentId: input.parentId }),
        },
        include: {
          children: true,
          _count: {
            select: { transactions: true },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return categories;
    }),

  // Get category tree (hierarchical)
  tree: protectedProcedure.query(async ({ ctx }) => {
    const categories = await ctx.db.category.findMany({
      where: { userId: ctx.session.user.id, parentId: null },
      include: {
        children: {
          include: {
            children: true,
            _count: { select: { transactions: true } },
          },
        },
        _count: { select: { transactions: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return categories;
  }),

  // Get single category
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const category = await ctx.db.category.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          parent: true,
          children: true,
          _count: { select: { transactions: true } },
        },
      });
      return category;
    }),

  // Create category
  create: protectedProcedure
    .input(createCategorySchema)
    .mutation(async ({ ctx, input }) => {
      const category = await ctx.db.category.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          icon: input.icon,
          color: input.color,
          parentId: input.parentId,
          defaultClassification: input.defaultClassification,
        },
      });
      return category;
    }),

  // Update category
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateCategorySchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.category.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Category not found');

      const category = await ctx.db.category.update({
        where: { id: input.id },
        data: input.data,
      });
      return category;
    }),

  // Delete category
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.category.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Category not found');

      // First, unassign transactions from this category
      await ctx.db.transaction.updateMany({
        where: { categoryId: input.id },
        data: { categoryId: null },
      });

      await ctx.db.category.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),

  // Get spending by category
  spending: protectedProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        type: z.enum(['EXPENSE', 'INCOME']).default('EXPENSE'),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const result = await ctx.db.transaction.groupBy({
        by: ['categoryId'],
        where: {
          account: { userId: ctx.session.user.id },
          type: input?.type ?? 'EXPENSE',
          date: {
            gte: input?.startDate ?? startOfMonth,
            lte: input?.endDate ?? endOfMonth,
          },
        },
        _sum: {
          amount: true,
        },
        _count: true,
      });

      // Get category details
      const categoryIds = result
        .map((r) => r.categoryId)
        .filter((id): id is string => id !== null);

      const categories = await ctx.db.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, icon: true, color: true },
      });

      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const totalSpend = result.reduce(
        (sum, r) => sum + Math.abs(Number(r._sum.amount ?? 0)),
        0
      );

      return result.map((r) => {
        const category = r.categoryId ? categoryMap.get(r.categoryId) : null;
        const amount = Math.abs(Number(r._sum.amount ?? 0));
        return {
          categoryId: r.categoryId,
          categoryName: category?.name ?? 'Uncategorized',
          icon: category?.icon ?? '❓',
          color: category?.color,
          amount,
          transactionCount: r._count,
          percentOfTotal: totalSpend > 0 ? (amount / totalSpend) * 100 : 0,
        };
      }).sort((a, b) => b.amount - a.amount);
    }),
});
