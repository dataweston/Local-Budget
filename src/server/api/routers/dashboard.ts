import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';

export const dashboardRouter = createTRPCRouter({
  // Get main dashboard stats
  stats: protectedProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startDate = input?.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = input?.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Calculate previous period of equal duration for trend comparison
      const periodMs = endDate.getTime() - startDate.getTime();
      const prevEndDate = new Date(startDate.getTime() - 1);
      const prevStartDate = new Date(prevEndDate.getTime() - periodMs);

      // Get account balances (always current)
      const accounts = await ctx.db.financialAccount.findMany({
        where: { userId: ctx.session.user.id, isActive: true },
        select: { currentBalance: true, type: true },
      });

      const totalBalance = accounts.reduce(
        (sum, acc) => sum + Number(acc.currentBalance),
        0
      );

      // Current period transactions
      const currentTransactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          date: { gte: startDate, lte: endDate },
        },
        select: { type: true, amount: true },
      });

      // Previous period transactions for trend
      const prevTransactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          date: { gte: prevStartDate, lte: prevEndDate },
        },
        select: { type: true, amount: true },
      });

      const calcTotal = (txs: typeof currentTransactions, type: string) =>
        Math.abs(txs.filter((t) => t.type === type).reduce((s, t) => s + Number(t.amount), 0));

      const income = calcTotal(currentTransactions, 'INCOME');
      const expenses = calcTotal(currentTransactions, 'EXPENSE');
      const prevIncome = calcTotal(prevTransactions, 'INCOME');
      const prevExpenses = calcTotal(prevTransactions, 'EXPENSE');

      const calcTrend = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
      };

      // Get pending counts (not date-filtered)
      const [pendingReceipts, unreviewedTransactions] = await Promise.all([
        ctx.db.receipt.count({
          where: { userId: ctx.session.user.id, status: { in: ['PENDING', 'PROCESSING'] } },
        }),
        ctx.db.transaction.count({
          where: { account: { userId: ctx.session.user.id }, isReviewed: false },
        }),
      ]);

      return {
        totalBalance,
        monthlyIncome: income,
        monthlyExpenses: expenses,
        monthlyNet: income - expenses,
        incomeTrend: calcTrend(income, prevIncome),
        expenseTrend: calcTrend(expenses, prevExpenses),
        pendingReceipts,
        unreviewedTransactions,
      };
    }),

  // Get cashflow over time
  cashflow: protectedProcedure
    .input(
      z.object({
        period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startDate = input?.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = input?.endDate ?? now;

      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          date: { gte: startDate, lte: endDate },
        },
        select: {
          date: true,
          type: true,
          amount: true,
          classification: true,
        },
        orderBy: { date: 'asc' },
      });

      // Group by period
      const groupingPeriod = input?.period ?? 'daily';
      const getDateKey = (date: Date): string => {
        switch (groupingPeriod) {
          case 'monthly':
            return date.toISOString().slice(0, 7); // YYYY-MM
          case 'weekly': {
            const d = new Date(date);
            const day = d.getDay();
            d.setDate(d.getDate() - day); // Start of week (Sunday)
            return d.toISOString().split('T')[0];
          }
          default:
            return date.toISOString().split('T')[0]; // YYYY-MM-DD
        }
      };

      const grouped = new Map<string, {
        date: string;
        income: number;
        expenses: number;
        net: number;
        cogs: number;
        operating: number;
        personal: number;
      }>();

      for (const tx of transactions) {
        const dateKey = getDateKey(tx.date);
        
        if (!grouped.has(dateKey)) {
          grouped.set(dateKey, {
            date: dateKey,
            income: 0,
            expenses: 0,
            net: 0,
            cogs: 0,
            operating: 0,
            personal: 0,
          });
        }

        const day = grouped.get(dateKey)!;
        const amount = Number(tx.amount);

        if (tx.type === 'INCOME') {
          day.income += amount;
        } else if (tx.type === 'EXPENSE') {
          day.expenses += Math.abs(amount);
          
          switch (tx.classification) {
            case 'COGS':
              day.cogs += Math.abs(amount);
              break;
            case 'OPERATING':
              day.operating += Math.abs(amount);
              break;
            case 'PERSONAL':
              day.personal += Math.abs(amount);
              break;
          }
        }

        day.net = day.income - day.expenses;
      }

      return Array.from(grouped.values());
    }),

  // Get P&L summary
  profitLoss: protectedProcedure
    .input(
      z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startDate = input?.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = input?.endDate ?? now;

      const transactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          date: { gte: startDate, lte: endDate },
        },
        include: {
          category: { select: { id: true, name: true } },
        },
      });

      let revenue = 0;
      let cogs = 0;
      let operatingExpenses = 0;
      const byCategory = new Map<string, { name: string; classification: string; amount: number }>();

      for (const tx of transactions) {
        const amount = Number(tx.amount);
        const categoryKey = tx.categoryId ?? 'uncategorized';
        const categoryName = tx.category?.name ?? 'Uncategorized';

        if (tx.classification === 'INCOME') {
          revenue += amount;
        } else if (tx.classification === 'COGS') {
          cogs += Math.abs(amount);
        } else if (tx.classification === 'OPERATING') {
          operatingExpenses += Math.abs(amount);
        }

        if (!byCategory.has(categoryKey)) {
          byCategory.set(categoryKey, {
            name: categoryName,
            classification: tx.classification ?? 'PERSONAL',
            amount: 0,
          });
        }
        byCategory.get(categoryKey)!.amount += Math.abs(amount);
      }

      const grossProfit = revenue - cogs;
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const operatingIncome = grossProfit - operatingExpenses;
      const operatingMargin = revenue > 0 ? (operatingIncome / revenue) * 100 : 0;

      return {
        period: { start: startDate, end: endDate },
        revenue,
        cogs,
        grossProfit,
        grossMargin,
        operatingExpenses,
        operatingIncome,
        operatingMargin,
        byCategory: Array.from(byCategory.entries()).map(([id, data]) => ({
          categoryId: id,
          ...data,
        })),
      };
    }),

  // Get recent activity for dashboard
  recentActivity: protectedProcedure
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

      const receipts = await ctx.db.receipt.findMany({
        where: { userId: ctx.session.user.id, status: { in: ['PENDING', 'PROCESSING', 'PROCESSED'] } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

      return {
        transactions,
        receipts,
      };
    }),
});
