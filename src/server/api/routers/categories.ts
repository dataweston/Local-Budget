import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { createCategorySchema, updateCategorySchema } from '@/lib/schemas';

const CLUSTER_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'card',
  'debit',
  'credit',
  'purchase',
  'payment',
  'transfer',
  'online',
  'pos',
  'ach',
  'pending',
  'posted',
  'transaction',
  'txn',
  'check',
  'visa',
  'mastercard',
  'mktplace',
  'pmts',
  'services',
  'service',
  'amzn',
  'amazon',
  'com',
]);

function normalizeClusterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateLabel(value: string, max = 48): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}...`;
}

function toTitleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function meaningfulFreeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}

function extractDescriptionCluster(description: string): string | null {
  const normalized = normalizeClusterText(description);
  if (!normalized) return null;
  const tokens = normalized
    .split(' ')
    .filter(
      (token) =>
        token.length >= 3 &&
        !CLUSTER_STOP_WORDS.has(token) &&
        !/^\d+$/.test(token)
    );
  if (tokens.length === 0) return null;
  return toTitleCase(tokens.slice(0, 4).join(' '));
}

type ClusterCandidate = {
  key: string;
  label: string;
  source: 'note' | 'userDescription' | 'lineItem' | 'merchant' | 'description' | 'other';
  example: string | null;
};

function deriveClusterCandidate(input: {
  notes?: string | null;
  userDescription?: string | null;
  description?: string | null;
  merchantName?: string | null;
  lineItems?: Array<{ description: string }>;
}): ClusterCandidate {
  const note = meaningfulFreeText(input.notes);
  if (note) {
    return {
      key: `note:${normalizeClusterText(note)}`,
      label: truncateLabel(note),
      source: 'note',
      example: truncateLabel(note, 72),
    };
  }

  const userDescription = meaningfulFreeText(input.userDescription);
  if (userDescription) {
    return {
      key: `user:${normalizeClusterText(userDescription)}`,
      label: truncateLabel(userDescription),
      source: 'userDescription',
      example: truncateLabel(userDescription, 72),
    };
  }

  const firstLineItem = input.lineItems?.find((li) =>
    meaningfulFreeText(li.description.replace(/^\[Amazon\]\s*/i, ''))
  );
  if (firstLineItem) {
    const lineItemLabel = firstLineItem.description.replace(/^\[Amazon\]\s*/i, '').trim();
    return {
      key: `item:${normalizeClusterText(lineItemLabel)}`,
      label: truncateLabel(lineItemLabel),
      source: 'lineItem',
      example: truncateLabel(lineItemLabel, 72),
    };
  }

  const merchant = meaningfulFreeText(input.merchantName);
  if (merchant) {
    const normalizedMerchant = normalizeClusterText(merchant);
    if (normalizedMerchant && !CLUSTER_STOP_WORDS.has(normalizedMerchant)) {
      return {
        key: `merchant:${normalizedMerchant}`,
        label: truncateLabel(merchant),
        source: 'merchant',
        example: truncateLabel(merchant, 72),
      };
    }
  }

  const description = meaningfulFreeText(input.description);
  if (description) {
    const descriptionLabel = extractDescriptionCluster(description);
    if (descriptionLabel) {
      return {
        key: `desc:${normalizeClusterText(descriptionLabel)}`,
        label: truncateLabel(descriptionLabel),
        source: 'description',
        example: truncateLabel(description, 72),
      };
    }
  }

  return {
    key: 'other',
    label: 'Other',
    source: 'other',
    example: null,
  };
}

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

  // Get spending by category with inferred sub-clusters from notes/description/merchant (split-aware)
  spendingClusters: protectedProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          type: z.enum(['EXPENSE', 'INCOME']).default('EXPENSE'),
          clusterLimit: z.number().min(1).max(10).default(4),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const targetType = input?.type ?? 'EXPENSE';
      const clusterLimit = input?.clusterLimit ?? 4;

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
          description: true,
          merchantName: true,
          notes: true,
          userDescription: true,
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
          lineItems: {
            select: { description: true },
            take: 3,
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

      type ClusterAggregate = {
        clusterKey: string;
        clusterLabel: string;
        clusterSource: ClusterCandidate['source'];
        amount: number;
        transactionIds: Set<string>;
        examples: Set<string>;
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
        clusters: Map<string, ClusterAggregate>;
      };

      const aggregates = new Map<string, AggregateRow>();

      const push = (
        tx: {
          id: string;
          description: string;
          merchantName: string | null;
          notes: string | null;
          userDescription: string | null;
          lineItems: Array<{ description: string }>;
        },
        amount: number,
        category: CategoryInfo | null
      ) => {
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
            clusters: new Map<string, ClusterAggregate>(),
          });
        }

        const row = aggregates.get(key)!;
        row.amount += amount;
        row.transactionIds.add(tx.id);

        const candidate = deriveClusterCandidate(tx);
        if (!row.clusters.has(candidate.key)) {
          row.clusters.set(candidate.key, {
            clusterKey: candidate.key,
            clusterLabel: candidate.label,
            clusterSource: candidate.source,
            amount: 0,
            transactionIds: new Set<string>(),
            examples: new Set<string>(),
          });
        }

        const cluster = row.clusters.get(candidate.key)!;
        cluster.amount += amount;
        cluster.transactionIds.add(tx.id);
        if (candidate.example) {
          cluster.examples.add(candidate.example);
        }
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
              tx,
              Math.abs(Number(split.amount)),
              (split.category as CategoryInfo | null) ?? (tx.category as CategoryInfo | null)
            );
          }
          continue;
        }

        if (txClassification === 'TRANSFER') continue;
        push(tx, Math.abs(Number(tx.amount)), tx.category as CategoryInfo | null);
      }

      const rows = Array.from(aggregates.values()).map((row) => {
        const fullClusters = Array.from(row.clusters.values())
          .map((cluster) => ({
            clusterKey: cluster.clusterKey,
            clusterLabel: cluster.clusterLabel,
            source: cluster.clusterSource,
            amount: cluster.amount,
            transactionCount: cluster.transactionIds.size,
            examples: Array.from(cluster.examples).slice(0, 2),
          }))
          .sort((a, b) => b.amount - a.amount);

        const visible = fullClusters.slice(0, clusterLimit);
        const hidden = fullClusters.slice(clusterLimit);
        if (hidden.length > 0) {
          const hiddenAmount = hidden.reduce((sum, c) => sum + c.amount, 0);
          const hiddenTxCount = hidden.reduce((sum, c) => sum + c.transactionCount, 0);
          visible.push({
            clusterKey: `other:${row.categoryId ?? 'uncategorized'}`,
            clusterLabel: `Other (${hidden.length})`,
            source: 'other',
            amount: hiddenAmount,
            transactionCount: hiddenTxCount,
            examples: [],
          });
        }

        return {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          icon: row.icon,
          color: row.color,
          parentCategoryId: row.parentCategoryId,
          parentCategoryName: row.parentCategoryName,
          amount: row.amount,
          transactionCount: row.transactionIds.size,
          totalClusterCount: fullClusters.length,
          clusters: visible.map((cluster) => ({
            ...cluster,
            percentOfCategory: row.amount > 0 ? (cluster.amount / row.amount) * 100 : 0,
          })),
        };
      });

      const totalSpend = rows.reduce((sum, row) => sum + row.amount, 0);

      return rows
        .map((row) => ({
          ...row,
          percentOfTotal: totalSpend > 0 ? (row.amount / totalSpend) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
    }),
});
