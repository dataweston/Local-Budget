import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  getEffectiveClassification,
  isIncomeForReporting,
  isExpenseForSpending,
  isTransferLikeTransaction,
} from '@/lib/transaction-filters';

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
        select: {
          type: true,
          amount: true,
          classification: true,
          category: {
            select: {
              defaultClassification: true,
            },
          },
        },
      });

      // Previous period transactions for trend
      const prevTransactions = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          date: { gte: prevStartDate, lte: prevEndDate },
        },
        select: {
          type: true,
          amount: true,
          classification: true,
          category: {
            select: {
              defaultClassification: true,
            },
          },
        },
      });

      const calcIncomeTotal = (txs: typeof currentTransactions) =>
        Math.abs(
          txs
            .filter((t) => isIncomeForReporting(t))
            .reduce((sum, t) => sum + Number(t.amount), 0)
        );

      const calcExpenseTotal = (txs: typeof currentTransactions) =>
        Math.abs(
          txs
            .filter((t) => isExpenseForSpending(t))
            .reduce((sum, t) => sum + Number(t.amount), 0)
        );

      const income = calcIncomeTotal(currentTransactions);
      const expenses = calcExpenseTotal(currentTransactions);
      const prevIncome = calcIncomeTotal(prevTransactions);
      const prevExpenses = calcExpenseTotal(prevTransactions);

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
          category: {
            select: {
              defaultClassification: true,
            },
          },
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
        const classification = getEffectiveClassification(tx);

        if (tx.type === 'INCOME' && !isTransferLikeTransaction(tx)) {
          day.income += amount;
        } else if (isExpenseForSpending(tx)) {
          day.expenses += Math.abs(amount);
          
          switch (classification) {
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
          category: { select: { id: true, name: true, defaultClassification: true } },
        },
      });

      let revenue = 0;
      let cogs = 0;
      let operatingExpenses = 0;
      let personalExpenses = 0;
      let reimbursableExpenses = 0;
      let reimbursementIncome = 0;
      const byCategory = new Map<string, { name: string; classification: string; amount: number }>();

      for (const tx of transactions) {
        const amount = Number(tx.amount);
        const categoryKey = tx.categoryId ?? 'uncategorized';
        const categoryName = tx.category?.name ?? 'Uncategorized';
        const classification = getEffectiveClassification(tx);

        if (classification === 'INCOME') {
          revenue += amount;
        } else if (classification === 'REIMBURSEMENT') {
          // Money coming back — type is INCOME, amount is negative in DB
          reimbursementIncome += Math.abs(amount);
        } else if (classification === 'COGS') {
          cogs += Math.abs(amount);
        } else if (classification === 'OPERATING') {
          operatingExpenses += Math.abs(amount);
        } else if (classification === 'REIMBURSABLE') {
          // Money paid out expecting reimbursement — type is EXPENSE
          reimbursableExpenses += Math.abs(amount);
        } else if (classification === 'PERSONAL') {
          personalExpenses += Math.abs(amount);
        }

        if (!byCategory.has(categoryKey)) {
          byCategory.set(categoryKey, {
            name: categoryName,
            classification,
            amount: 0,
          });
        }
        byCategory.get(categoryKey)!.amount += Math.abs(amount);
      }

      // Reimbursements are income-like (money returned), add to revenue
      const totalRevenue = revenue + reimbursementIncome;
      const grossProfit = totalRevenue - cogs;
      const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
      const operatingIncome = grossProfit - operatingExpenses - reimbursableExpenses;
      const operatingMargin = totalRevenue > 0 ? (operatingIncome / totalRevenue) * 100 : 0;
      const totalExpenses = cogs + operatingExpenses + personalExpenses + reimbursableExpenses;
      const netIncome = totalRevenue - totalExpenses;
      const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;
      const savingsRate = totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0;

      return {
        period: { start: startDate, end: endDate },
        revenue: totalRevenue,
        cogs,
        grossProfit,
        grossMargin,
        operatingExpenses,
        personalExpenses,
        reimbursableExpenses,
        reimbursementIncome,
        operatingIncome,
        operatingMargin,
        netIncome,
        netMargin,
        savingsRate,
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
