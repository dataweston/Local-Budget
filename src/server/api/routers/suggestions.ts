import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { suggestCategory, suggestCategoriesForUncategorized } from '@/lib/ml/categorizer';

export const suggestionsRouter = createTRPCRouter({
  // Get category suggestions for a single transaction
  forTransaction: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .query(async ({ ctx, input }) => {
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

      const suggestions = await suggestCategory(
        ctx.session.user.id,
        transaction.merchantName,
        transaction.description,
        transaction.type
      );

      return {
        transactionId: transaction.id,
        suggestions,
      };
    }),

  // Get suggestions for all uncategorized transactions
  forUncategorized: protectedProcedure
    .input(
      z.object({
        limit: z.number().optional().default(50),
        search: z.string().optional(),
        accountId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const search = input?.search?.trim();
      const accountId = input?.accountId;
      const suggestions = await suggestCategoriesForUncategorized(
        ctx.session.user.id,
        limit,
        search,
        accountId
      );

      const totalMatches = await ctx.db.transaction.count({
        where: {
          account: { userId: ctx.session.user.id },
          ...(accountId && { accountId }),
          categoryId: null,
          ...(search && {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              { merchantName: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
      });

      return {
        items: suggestions,
        totalMatches,
      };
    }),

  // Apply a single suggestion
  applySuggestion: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        categoryId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership of transaction
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

      // Verify category belongs to user
      const category = await ctx.db.category.findFirst({
        where: {
          id: input.categoryId,
          userId: ctx.session.user.id,
        },
        select: {
          id: true,
          defaultClassification: true,
        },
      });

      if (!category) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Category not found',
        });
      }

      // Update transaction
      const updated = await ctx.db.transaction.update({
        where: { id: input.transactionId },
        data: {
          categoryId: input.categoryId,
          ...(transaction.classification == null &&
            category.defaultClassification && {
              classification: category.defaultClassification,
            }),
          isReviewed: true,
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              icon: true,
            },
          },
        },
      });

      return updated;
    }),

  // Apply multiple suggestions at once
  applyBulk: protectedProcedure
    .input(
      z.object({
        suggestions: z.array(
          z.object({
            transactionId: z.string(),
            categoryId: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify all transactions belong to user
      const transactions = await ctx.db.transaction.findMany({
        where: {
          id: { in: input.suggestions.map((s) => s.transactionId) },
          account: { userId: ctx.session.user.id },
        },
      });

      if (transactions.length !== input.suggestions.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'One or more transactions not found',
        });
      }

      // Verify all categories belong to user
      const categories = await ctx.db.category.findMany({
        where: {
          id: { in: input.suggestions.map((s) => s.categoryId) },
          userId: ctx.session.user.id,
        },
        select: {
          id: true,
          defaultClassification: true,
        },
      });

      const categoryIds = new Set(categories.map((c) => c.id));
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const transactionMap = new Map(transactions.map((t) => [t.id, t]));
      const invalidCategories = input.suggestions.filter(
        (s) => !categoryIds.has(s.categoryId)
      );

      if (invalidCategories.length > 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'One or more categories not found',
        });
      }

      // Apply all suggestions
      const updates = await Promise.all(
        input.suggestions.map((suggestion) =>
          {
            const tx = transactionMap.get(suggestion.transactionId);
            const category = categoryMap.get(suggestion.categoryId);
            return ctx.db.transaction.update({
              where: { id: suggestion.transactionId },
              data: {
                categoryId: suggestion.categoryId,
                ...(tx?.classification == null &&
                  category?.defaultClassification && {
                    classification: category.defaultClassification,
                  }),
                isReviewed: true,
              },
            });
          }
        )
      );

      return {
        updated: updates.length,
        transactions: updates,
      };
    }),
});
