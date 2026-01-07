import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { createRuleSchema, updateRuleSchema, ruleMatchTypeEnum, classificationTypeEnum } from '@/lib/schemas';
import { TRPCError } from '@trpc/server';

export const rulesRouter = createTRPCRouter({
  // List all rules
  list: protectedProcedure
    .input(
      z.object({
        isActive: z.boolean().optional(),
        categoryId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const rules = await ctx.db.classificationRule.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.isActive !== undefined && { isActive: input.isActive }),
          ...(input?.categoryId && { categoryId: input.categoryId }),
        },
        include: {
          category: {
            select: { id: true, name: true, color: true },
          },
        },
        orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      });
      return rules;
    }),

  // Get single rule
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const rule = await ctx.db.classificationRule.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          category: true,
        },
      });
      if (!rule) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      }
      return rule;
    }),

  // Create rule
  create: protectedProcedure
    .input(createRuleSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate regex if matchType is REGEX
      if (input.matchType === 'REGEX') {
        try {
          new RegExp(input.matchValue);
        } catch {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid regex pattern',
          });
        }
      }

      const rule = await ctx.db.classificationRule.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          matchField: input.matchField,
          matchType: input.matchType,
          matchValue: input.matchValue,
          categoryId: input.categoryId,
          classification: input.classification,
          incurredById: input.incurredById,
          priority: input.priority,
        },
        include: {
          category: true,
        },
      });
      return rule;
    }),

  // Update rule
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateRuleSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.classificationRule.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      }

      // Validate regex if updating to REGEX type
      if (input.data.matchType === 'REGEX' && input.data.matchValue) {
        try {
          new RegExp(input.data.matchValue);
        } catch {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid regex pattern',
          });
        }
      }

      const rule = await ctx.db.classificationRule.update({
        where: { id: input.id },
        data: input.data,
        include: {
          category: true,
        },
      });
      return rule;
    }),

  // Delete rule
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.classificationRule.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      }

      await ctx.db.classificationRule.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),

  // Toggle rule active state
  toggleActive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.classificationRule.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      }

      const rule = await ctx.db.classificationRule.update({
        where: { id: input.id },
        data: { isActive: !existing.isActive },
      });
      return rule;
    }),

  // Apply rules to uncategorized transactions
  applyRules: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()).optional(),
        dryRun: z.boolean().default(false),
      }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      // Get all active rules for this user, ordered by priority
      const rules = await ctx.db.classificationRule.findMany({
        where: {
          userId: ctx.session.user.id,
          isActive: true,
        },
        orderBy: { priority: 'desc' },
      });

      if (rules.length === 0) {
        return { matched: 0, updated: 0, results: [] };
      }

      // Get transactions to process
      const transactionWhere = {
        account: { userId: ctx.session.user.id },
        ...(input?.transactionIds && { id: { in: input.transactionIds } }),
        ...(!input?.transactionIds && { categoryId: null }), // Only uncategorized if no specific IDs
      };

      const transactions = await ctx.db.transaction.findMany({
        where: transactionWhere,
        select: {
          id: true,
          description: true,
          merchantName: true,
          amount: true,
          categoryId: true,
          classification: true,
        },
      });

      const results: Array<{
        transactionId: string;
        ruleName: string;
        categoryId?: string | null;
        classification?: string | null;
      }> = [];

      // Apply rules
      for (const transaction of transactions) {
        for (const rule of rules) {
          const fieldValue = getFieldValue(transaction, rule.matchField);
          if (!fieldValue) continue;

          const matches = matchRule(fieldValue, rule.matchType, rule.matchValue);
          if (matches) {
            results.push({
              transactionId: transaction.id,
              ruleName: rule.name,
              categoryId: rule.categoryId,
              classification: rule.classification,
            });

            if (!input?.dryRun) {
              // Update transaction
              await ctx.db.transaction.update({
                where: { id: transaction.id },
                data: {
                  ...(rule.categoryId && { categoryId: rule.categoryId }),
                  ...(rule.classification && { classification: rule.classification }),
                  ...(rule.incurredById && { incurredById: rule.incurredById }),
                },
              });

              // Update rule stats
              await ctx.db.classificationRule.update({
                where: { id: rule.id },
                data: {
                  timesApplied: { increment: 1 },
                  lastAppliedAt: new Date(),
                },
              });
            }

            break; // Stop after first matching rule (highest priority wins)
          }
        }
      }

      return {
        matched: results.length,
        updated: input?.dryRun ? 0 : results.length,
        results,
      };
    }),

  // Get rule suggestions based on transaction patterns
  suggest: protectedProcedure
    .input(
      z.object({
        minOccurrences: z.number().default(3),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      // Find frequently occurring merchant names without categories
      const merchantGroups = await ctx.db.transaction.groupBy({
        by: ['merchantName'],
        where: {
          account: { userId: ctx.session.user.id },
          categoryId: null,
          merchantName: { not: null },
        },
        _count: { merchantName: true },
        having: {
          merchantName: { _count: { gte: input?.minOccurrences ?? 3 } },
        },
        orderBy: { _count: { merchantName: 'desc' } },
        take: 20,
      });

      // Find categorized transactions with similar merchants to suggest rules
      const suggestions: Array<{
        merchantName: string;
        occurrences: number;
        suggestedCategoryId?: string;
        suggestedCategoryName?: string;
      }> = [];

      for (const group of merchantGroups) {
        if (!group.merchantName) continue;

        // Look for similar categorized transactions
        const categorized = await ctx.db.transaction.findFirst({
          where: {
            account: { userId: ctx.session.user.id },
            merchantName: { contains: group.merchantName, mode: 'insensitive' },
            categoryId: { not: null },
          },
          include: { category: true },
        });

        suggestions.push({
          merchantName: group.merchantName,
          occurrences: group._count.merchantName,
          suggestedCategoryId: categorized?.categoryId ?? undefined,
          suggestedCategoryName: categorized?.category?.name,
        });
      }

      return suggestions;
    }),

  // Test a rule against transactions
  test: protectedProcedure
    .input(
      z.object({
        matchField: z.string(),
        matchType: ruleMatchTypeEnum,
        matchValue: z.string(),
        limit: z.number().default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      // Validate regex
      if (input.matchType === 'REGEX') {
        try {
          new RegExp(input.matchValue);
        } catch {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid regex pattern',
          });
        }
      }

      // Get transactions and test manually
      const transactions = await ctx.db.transaction.findMany({
        where: { account: { userId: ctx.session.user.id } },
        select: {
          id: true,
          description: true,
          merchantName: true,
          amount: true,
          date: true,
        },
        orderBy: { date: 'desc' },
        take: 500, // Check last 500 transactions
      });

      const matches: typeof transactions = [];
      for (const tx of transactions) {
        const fieldValue = getFieldValue(tx, input.matchField);
        if (fieldValue && matchRule(fieldValue, input.matchType, input.matchValue)) {
          matches.push(tx);
          if (matches.length >= input.limit) break;
        }
      }

      return { matches, totalChecked: transactions.length };
    }),
});

// Helper: Get field value from transaction
function getFieldValue(
  transaction: { description?: string; merchantName?: string | null; amount?: unknown },
  field: string
): string | null {
  switch (field) {
    case 'merchantName':
      return transaction.merchantName ?? null;
    case 'description':
      return transaction.description ?? null;
    case 'amount':
      return transaction.amount?.toString() ?? null;
    default:
      return null;
  }
}

// Helper: Match rule against value
function matchRule(value: string, matchType: string, pattern: string): boolean {
  const lowerValue = value.toLowerCase();
  const lowerPattern = pattern.toLowerCase();

  switch (matchType) {
    case 'EXACT':
      return lowerValue === lowerPattern;
    case 'CONTAINS':
      return lowerValue.includes(lowerPattern);
    case 'STARTS_WITH':
      return lowerValue.startsWith(lowerPattern);
    case 'REGEX':
      try {
        return new RegExp(pattern, 'i').test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
