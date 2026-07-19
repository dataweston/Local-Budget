import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import {
  getEffectiveClassification,
  isIncomeForReporting,
  isExpenseForSpending,
  isTransferLikeTransaction,
} from '@/lib/transaction-filters';
import {
  blankReport as blankPnlReport,
  aggregatePnl,
  derivePnlMetrics,
} from '@/lib/pnl';

export const dashboardRouter = createTRPCRouter({
  // Get main dashboard stats
  stats: protectedProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startDate = input?.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate =
        input?.endDate ??
        new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Calculate previous period of equal duration for trend comparison
      const periodMs = endDate.getTime() - startDate.getTime();
      const prevEndDate = new Date(startDate.getTime() - 1);
      const prevStartDate = new Date(prevEndDate.getTime() - periodMs);

      // Get account balances (always current)
      const accounts = await ctx.db.financialAccount.findMany({
        where: { userId: ctx.session.user.id, isActive: true },
        select: { currentBalance: true, type: true },
      });

      const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.currentBalance), 0);

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
          where: {
            userId: ctx.session.user.id,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
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
      z
        .object({
          period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
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

      const grouped = new Map<
        string,
        {
          date: string;
          income: number;
          expenses: number;
          net: number;
          cogs: number;
          operating: number;
          personal: number;
        }
      >();

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
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
        })
        .optional()
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
          id: true,
          amount: true,
          type: true,
          classification: true,
          categoryId: true,
          category: { select: { id: true, name: true, defaultClassification: true } },
          splits: {
            select: {
              amount: true,
              classification: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  defaultClassification: true,
                },
              },
            },
          },
        },
      });

      // Shared P&L aggregation (single source of truth in @/lib/pnl):
      // contra-revenue netting, split handling, and category rollup.
      const report = blankPnlReport(startDate.getFullYear());
      aggregatePnl(report, transactions);
      const derived = derivePnlMetrics(report);

      const {
        cogs,
        operatingExpenses,
        personalExpenses,
        reimbursableExpenses,
        reimbursementIncome,
        refunds,
        uncategorizedAmount,
        uncategorizedCount,
        totalLinesConsidered: totalTransactionsConsidered,
      } = report;
      const {
        totalRevenue,
        grossProfit,
        grossMargin,
        operatingIncome,
        operatingMargin,
        netBusinessIncome,
        totalExpenses,
        netCashFlow,
        savingsRate,
      } = derived;

      // The reports waterfall shows Revenue − COGS − OpEx − Personal = Net,
      // so the `netIncome` field keeps that cash-flow meaning; the business
      // figures (excluding personal) are exposed alongside.
      const netIncome = netCashFlow;
      const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;
      const businessNetMargin = derived.netMargin;

      const totalPnlVolume = totalRevenue + totalExpenses;
      const daysInPeriod = Math.max(
        1,
        Math.ceil((endDate.getTime() - startDate.getTime() + 1) / 86_400_000)
      );
      const monthsInPeriod = Math.max(daysInPeriod / 30.4375, 1 / 30.4375);
      const averageMonthlyRevenue = totalRevenue / monthsInPeriod;
      const averageMonthlyExpenses = totalExpenses / monthsInPeriod;
      const averageMonthlyNet = netIncome / monthsInPeriod;
      const operatingBurnRate = (cogs + operatingExpenses + reimbursableExpenses) / monthsInPeriod;
      const expenseCoverageRatio =
        totalExpenses > 0 ? totalRevenue / totalExpenses : totalRevenue > 0 ? Infinity : 0;

      const topExpenseCategoryAmount = Array.from(report.byCategory.values())
        .filter((row) =>
          ['COGS', 'OPERATING', 'PERSONAL', 'REIMBURSABLE'].includes(row.classification)
        )
        .reduce((max, row) => Math.max(max, row.amount), 0);
      const topExpenseCategoryShare =
        totalExpenses > 0 ? (topExpenseCategoryAmount / totalExpenses) * 100 : 0;

      return {
        period: { start: startDate, end: endDate },
        revenue: totalRevenue,
        refunds,
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
        netBusinessIncome,
        businessNetMargin,
        savingsRate,
        totalExpenses,
        totalPnlVolume,
        daysInPeriod,
        monthsInPeriod,
        averageMonthlyRevenue,
        averageMonthlyExpenses,
        averageMonthlyNet,
        operatingBurnRate,
        expenseCoverageRatio,
        topExpenseCategoryShare,
        uncategorizedAmount,
        uncategorizedCount,
        totalTransactionsConsidered,
        byCategory: Array.from(report.byCategory.values())
          .map((row) => ({
            categoryId: row.categoryId,
            name: row.name,
            classification: row.classification,
            amount: row.amount,
            transactionCount: row.transactionCount,
            percentOfTotal: totalPnlVolume > 0 ? (row.amount / totalPnlVolume) * 100 : 0,
          }))
          .sort((a, b) => b.amount - a.amount),
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
        where: {
          userId: ctx.session.user.id,
          status: { in: ['PENDING', 'PROCESSING', 'PROCESSED'] },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

      return {
        transactions,
        receipts,
      };
    }),
});
