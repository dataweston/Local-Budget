import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { createCategorySchema, updateCategorySchema } from '@/lib/schemas';

export const categoriesRouter = createTRPCRouter({
  // List all categories
  list: protectedProcedure
    .input(
      z
        .object({
          includeSystem: z.boolean().default(true),
          parentId: z.string().nullable().optional(),
        })
        .optional()
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
      if (input.parentId) {
        const parent = await ctx.db.category.findFirst({
          where: { id: input.parentId, userId: ctx.session.user.id },
          select: { id: true },
        });
        if (!parent) {
          throw new Error('Parent category not found');
        }
      }

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

      if (input.data.parentId === input.id) {
        throw new Error('Category cannot be its own parent');
      }

      if (input.data.parentId) {
        const parent = await ctx.db.category.findFirst({
          where: { id: input.data.parentId, userId: ctx.session.user.id },
          select: { id: true },
        });
        if (!parent) {
          throw new Error('Parent category not found');
        }
      }

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

  // Get spending by category (split-aware)
  spending: protectedProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          type: z.enum(['EXPENSE', 'INCOME']).default('EXPENSE'),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const targetType = input?.type ?? 'EXPENSE';

      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          type: targetType,
          date: {
            gte: input?.startDate ?? startOfMonth,
            lte: input?.endDate ?? endOfMonth,
          },
        },
        select: {
          id: true,
          amount: true,
          classification: true,
          category: {
            select: {
              id: true,
              name: true,
              icon: true,
              color: true,
              defaultClassification: true,
              parentId: true,
              parent: { select: { id: true, name: true } },
            },
          },
          splits: {
            select: {
              amount: true,
              classification: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  icon: true,
                  color: true,
                  defaultClassification: true,
                  parentId: true,
                  parent: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });

      type CategoryInfo = {
        id: string;
        name: string;
        icon: string | null;
        color: string | null;
        parentId: string | null;
        parent: { id: string; name: string } | null;
      };

      type AggregateRow = {
        categoryId: string | null;
        categoryName: string;
        icon: string | null;
        color: string | null;
        parentCategoryId: string | null;
        parentCategoryName: string | null;
        amount: number;
        transactionIds: Set<string>;
      };

      const aggregates = new Map<string, AggregateRow>();

      const push = (transactionId: string, amount: number, category: CategoryInfo | null) => {
        const categoryId = category?.id ?? null;
        const categoryName = category?.name ?? 'Uncategorized';
        const key = categoryId ?? `uncategorized:${categoryName}`;

        if (!aggregates.has(key)) {
          aggregates.set(key, {
            categoryId,
            categoryName,
            icon: category?.icon ?? '?',
            color: category?.color ?? null,
            parentCategoryId: category?.parentId ?? null,
            parentCategoryName: category?.parent?.name ?? null,
            amount: 0,
            transactionIds: new Set<string>(),
          });
        }

        const row = aggregates.get(key)!;
        row.amount += amount;
        row.transactionIds.add(transactionId);
      };

      for (const tx of transactions) {
        const txClassification = tx.classification ?? tx.category?.defaultClassification ?? null;

        if (tx.splits.length > 0) {
          for (const split of tx.splits) {
            const splitClassification =
              split.classification ??
              split.category?.defaultClassification ??
              txClassification;
            if (splitClassification === 'TRANSFER') continue;

            push(
              tx.id,
              Math.abs(Number(split.amount)),
              (split.category as CategoryInfo | null) ?? (tx.category as CategoryInfo | null)
            );
          }
          continue;
        }

        if (txClassification === 'TRANSFER') continue;
        push(tx.id, Math.abs(Number(tx.amount)), tx.category as CategoryInfo | null);
      }

      const rows = Array.from(aggregates.values()).map((row) => ({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        icon: row.icon,
        color: row.color,
        parentCategoryId: row.parentCategoryId,
        parentCategoryName: row.parentCategoryName,
        amount: row.amount,
        transactionCount: row.transactionIds.size,
      }));

      const totalSpend = rows.reduce((sum, row) => sum + row.amount, 0);

      return rows
        .map((row) => ({
          ...row,
          percentOfTotal: totalSpend > 0 ? (row.amount / totalSpend) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
    }),
});
