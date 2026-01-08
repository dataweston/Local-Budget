import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { normalizeVendorName, findSimilarVendors } from '@/lib/normalization/vendors';
import { Prisma } from '@prisma/client';

export const vendorsRouter = createTRPCRouter({
  // List all unique vendors with spending data
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        sortBy: z.enum(['name', 'spending', 'count']).optional().default('spending'),
        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
        limit: z.number().optional().default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const search = input?.search;
      const sortBy = input?.sortBy ?? 'spending';
      const sortOrder = input?.sortOrder ?? 'desc';
      const limit = input?.limit ?? 50;

      // Get all transactions with merchant names for the user
      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          merchantName: { not: null },
        },
        select: {
          merchantName: true,
          amount: true,
          type: true,
          categoryId: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Group by merchant name
      const vendorMap = new Map<string, {
        name: string;
        normalizedName: string;
        count: number;
        totalSpending: number;
        categories: Map<string, { name: string; count: number }>;
      }>();

      for (const tx of transactions) {
        if (!tx.merchantName) continue;

        const normalized = normalizeVendorName(tx.merchantName);
        const amount = Number(tx.amount);

        if (!vendorMap.has(normalized)) {
          vendorMap.set(normalized, {
            name: normalized,
            normalizedName: normalized.toLowerCase(),
            count: 0,
            totalSpending: 0,
            categories: new Map(),
          });
        }

        const vendor = vendorMap.get(normalized)!;
        vendor.count++;
        
        // Only count expenses towards spending
        if (tx.type === 'EXPENSE') {
          vendor.totalSpending += Math.abs(amount);
        }

        // Track category distribution
        if (tx.category) {
          const catKey = tx.category.id;
          if (!vendor.categories.has(catKey)) {
            vendor.categories.set(catKey, {
              name: tx.category.name,
              count: 0,
            });
          }
          vendor.categories.get(catKey)!.count++;
        }
      }

      // Convert to array
      let vendors = Array.from(vendorMap.values()).map((v) => ({
        name: v.name,
        normalizedName: v.normalizedName,
        count: v.count,
        totalSpending: v.totalSpending,
        categories: Array.from(v.categories.values()).sort((a, b) => b.count - a.count),
      }));

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        vendors = vendors.filter((v) =>
          v.name.toLowerCase().includes(searchLower)
        );
      }

      // Sort
      vendors.sort((a, b) => {
        let aVal, bVal;
        switch (sortBy) {
          case 'name':
            aVal = a.name;
            bVal = b.name;
            break;
          case 'spending':
            aVal = a.totalSpending;
            bVal = b.totalSpending;
            break;
          case 'count':
            aVal = a.count;
            bVal = b.count;
            break;
          default:
            aVal = a.totalSpending;
            bVal = b.totalSpending;
        }

        if (sortOrder === 'asc') {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });

      return {
        vendors: vendors.slice(0, limit),
        total: vendors.length,
      };
    }),

  // Get vendor details with transactions
  getByName: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      const normalized = normalizeVendorName(input.name);

      // Get all transactions for this vendor
      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          merchantName: { not: null },
        },
        include: {
          account: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              icon: true,
            },
          },
        },
        orderBy: {
          date: 'desc',
        },
      });

      // Filter to matching vendor names
      const matchingTransactions = transactions.filter((tx) => {
        if (!tx.merchantName) return false;
        return normalizeVendorName(tx.merchantName) === normalized;
      });

      // Calculate statistics
      const stats = {
        totalSpending: 0,
        totalIncome: 0,
        transactionCount: matchingTransactions.length,
        categoryBreakdown: new Map<string, { name: string; amount: number; count: number }>(),
        monthlyTrend: new Map<string, number>(),
      };

      for (const tx of matchingTransactions) {
        const amount = Number(tx.amount);

        if (tx.type === 'EXPENSE') {
          stats.totalSpending += Math.abs(amount);
        } else if (tx.type === 'INCOME') {
          stats.totalIncome += amount;
        }

        // Category breakdown
        if (tx.category) {
          const catKey = tx.category.id;
          if (!stats.categoryBreakdown.has(catKey)) {
            stats.categoryBreakdown.set(catKey, {
              name: tx.category.name,
              amount: 0,
              count: 0,
            });
          }
          const cat = stats.categoryBreakdown.get(catKey)!;
          cat.amount += Math.abs(amount);
          cat.count++;
        }

        // Monthly trend
        const monthKey = tx.date.toISOString().slice(0, 7); // YYYY-MM
        stats.monthlyTrend.set(
          monthKey,
          (stats.monthlyTrend.get(monthKey) || 0) + Math.abs(amount)
        );
      }

      return {
        name: normalized,
        transactions: matchingTransactions,
        stats: {
          totalSpending: stats.totalSpending,
          totalIncome: stats.totalIncome,
          transactionCount: stats.transactionCount,
          categoryBreakdown: Array.from(stats.categoryBreakdown.values()).sort(
            (a, b) => b.amount - a.amount
          ),
          monthlyTrend: Array.from(stats.monthlyTrend.entries())
            .map(([month, amount]) => ({ month, amount }))
            .sort((a, b) => a.month.localeCompare(b.month)),
        },
      };
    }),

  // Find potential duplicate vendors
  findDuplicates: protectedProcedure
    .input(
      z.object({
        threshold: z.number().optional().default(0.8),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const threshold = input?.threshold ?? 0.8;

      // Get all unique vendors
      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          merchantName: { not: null },
        },
        select: {
          merchantName: true,
        },
        distinct: ['merchantName'],
      });

      const vendors = transactions
        .map((tx) => ({
          name: tx.merchantName!,
          normalized: normalizeVendorName(tx.merchantName!),
        }))
        .filter((v) => v.name && v.normalized);

      // Find similar vendors
      const duplicates = findSimilarVendors(vendors, threshold);

      return duplicates;
    }),

  // Merge vendors (rename all occurrences)
  merge: protectedProcedure
    .input(
      z.object({
        sourceNames: z.array(z.string()),
        targetName: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get all transactions that match the source names
      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          merchantName: { not: null },
        },
      });

      // Filter to matching transactions
      const toUpdate = transactions.filter((tx) => {
        if (!tx.merchantName) return false;
        const normalized = normalizeVendorName(tx.merchantName);
        return input.sourceNames.some(
          (source) => normalizeVendorName(source) === normalized
        );
      });

      if (toUpdate.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No transactions found for the specified vendors',
        });
      }

      // Update all matching transactions
      const updates = await Promise.all(
        toUpdate.map((tx) =>
          ctx.db.transaction.update({
            where: { id: tx.id },
            data: { merchantName: input.targetName },
          })
        )
      );

      return {
        updated: updates.length,
        targetName: input.targetName,
      };
    }),

  // Get spending trend for a vendor over time
  spendingTrend: protectedProcedure
    .input(
      z.object({
        vendorName: z.string(),
        period: z.enum(['month', 'quarter', 'year']).optional().default('month'),
      })
    )
    .query(async ({ ctx, input }) => {
      const normalized = normalizeVendorName(input.vendorName);

      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          merchantName: { not: null },
          type: 'EXPENSE',
        },
        select: {
          merchantName: true,
          amount: true,
          date: true,
        },
        orderBy: {
          date: 'asc',
        },
      });

      // Filter and group by period
      const trendMap = new Map<string, number>();

      for (const tx of transactions) {
        if (!tx.merchantName) continue;
        if (normalizeVendorName(tx.merchantName) !== normalized) continue;

        const amount = Number(tx.amount);
        let periodKey: string;

        switch (input.period) {
          case 'year':
            periodKey = tx.date.getFullYear().toString();
            break;
          case 'quarter':
            const quarter = Math.floor(tx.date.getMonth() / 3) + 1;
            periodKey = `${tx.date.getFullYear()}-Q${quarter}`;
            break;
          case 'month':
          default:
            periodKey = tx.date.toISOString().slice(0, 7); // YYYY-MM
            break;
        }

        trendMap.set(
          periodKey,
          (trendMap.get(periodKey) || 0) + Math.abs(amount)
        );
      }

      return Array.from(trendMap.entries())
        .map(([period, amount]) => ({ period, amount }))
        .sort((a, b) => a.period.localeCompare(b.period));
    }),
});
