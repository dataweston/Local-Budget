import { createTRPCRouter, protectedProcedure } from '../trpc';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  blankReport,
  aggregatePnl,
  finalizePnlReport,
  getEffectiveClassification,
} from '@/lib/pnl';
import { scheduleCLineForCategory, LINE_COGS } from '@/lib/tax';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });

function yearRange(year: number) {
  return {
    gte: new Date(`${year}-01-01T00:00:00.000Z`),
    lte: new Date(`${year}-12-31T23:59:59.999Z`),
  };
}

/**
 * Tax-oriented reports: collected sales tax, owner draws/contributions,
 * 1099-NEC candidates, and a Schedule C summary. All figures are cash-basis
 * and follow the unified P&L semantics in @/lib/pnl. Reporting aids, not tax
 * advice.
 */
export const taxRouter = createTRPCRouter({
  /**
   * Sales tax collected, by month. Reads the auto-splits the Square sync
   * writes ('Sales tax collected (Square)'). Zero until tax collection is
   * enabled at the POS — the report existing keeps the books honest the day
   * that starts.
   */
  salesTaxCollected: protectedProcedure.input(yearInput).query(async ({ ctx, input }) => {
    const splits = await ctx.db.transactionSplit.findMany({
      where: {
        description: 'Sales tax collected (Square)',
        transaction: {
          account: { userId: ctx.session.user.id },
          date: yearRange(input.year),
          status: 'POSTED',
        },
      },
      select: {
        amount: true,
        transaction: { select: { date: true } },
      },
    });

    const byMonth = new Map<string, number>();
    let total = 0;
    for (const s of splits) {
      const month = s.transaction.date.toISOString().slice(0, 7);
      const amt = Number(s.amount);
      byMonth.set(month, (byMonth.get(month) ?? 0) + amt);
      total += amt;
    }

    return {
      year: input.year,
      total,
      months: Array.from(byMonth.entries())
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }),

  /**
   * Owner draws and contributions (equity movements), from the boundary
   * crossings the transfer reconciler tags via metadata.transferException.
   */
  ownerEquity: protectedProcedure.input(yearInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db.transaction.findMany({
      where: {
        account: { userId: ctx.session.user.id },
        date: yearRange(input.year),
        metadata: {
          path: ['transferException'],
          not: Prisma.JsonNull,
        },
      },
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        metadata: true,
        account: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    });

    let draws = 0;
    let contributions = 0;
    const entries = [];
    for (const r of rows) {
      const reason = (r.metadata as Record<string, unknown> | null)?.transferException;
      if (reason !== 'owner_draw' && reason !== 'owner_contribution') continue;
      const amount = Math.abs(Number(r.amount));
      if (reason === 'owner_draw') draws += amount;
      else contributions += amount;
      entries.push({
        id: r.id,
        date: r.date,
        amount,
        kind: reason,
        description: r.description,
        accountName: r.account.name,
      });
    }

    return { year: input.year, draws, contributions, net: contributions - draws, entries };
  }),

  /**
   * 1099-NEC candidates: business-classified payments grouped by payee, with
   * calendar-year totals at/above the $600 reporting threshold. Personal
   * spending and transfers are excluded. Whether a payee is actually
   * 1099-reportable (unincorporated, services not goods) is a human call —
   * this surfaces who to look at, with the payment channel as a hint.
   */
  contractorCandidates: protectedProcedure.input(yearInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db.transaction.findMany({
      where: {
        account: { userId: ctx.session.user.id },
        date: yearRange(input.year),
        type: 'EXPENSE',
        status: 'POSTED',
      },
      select: {
        amount: true,
        merchantName: true,
        description: true,
        classification: true,
        type: true,
        vendorId: true,
        vendor: { select: { name: true } },
        category: { select: { defaultClassification: true } },
      },
    });

    const byPayee = new Map<
      string,
      { payee: string; total: number; paymentCount: number; channels: Set<string> }
    >();

    for (const r of rows) {
      const cls = getEffectiveClassification(r);
      if (cls !== 'COGS' && cls !== 'OPERATING') continue;

      const payee = r.vendor?.name ?? r.merchantName ?? 'Unknown payee';
      const key = r.vendorId ?? payee.toLowerCase();
      let row = byPayee.get(key);
      if (!row) {
        row = { payee, total: 0, paymentCount: 0, channels: new Set() };
        byPayee.set(key, row);
      }
      row.total += Math.abs(Number(r.amount));
      row.paymentCount += 1;

      const text = `${r.description} ${r.merchantName ?? ''}`.toLowerCase();
      if (text.includes('venmo')) row.channels.add('venmo');
      else if (text.includes('zelle')) row.channels.add('zelle');
      else if (text.includes('check')) row.channels.add('check');
      else row.channels.add('card/ach');
    }

    const candidates = Array.from(byPayee.values())
      .filter((r) => r.total >= 600)
      .map((r) => ({ ...r, channels: Array.from(r.channels) }))
      .sort((a, b) => b.total - a.total);

    return { year: input.year, threshold: 600, candidates };
  }),

  /**
   * Schedule C summary: the year's business P&L mapped onto Schedule C lines.
   * Personal spending, reimbursables, and transfers are excluded.
   */
  scheduleC: protectedProcedure.input(yearInput).query(async ({ ctx, input }) => {
    const transactions = await ctx.db.transaction.findMany({
      where: {
        account: { userId: ctx.session.user.id },
        date: yearRange(input.year),
        status: 'POSTED',
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
            category: { select: { id: true, name: true, defaultClassification: true } },
          },
        },
      },
    });

    const report = blankReport(input.year);
    aggregatePnl(report, transactions);
    const pnl = finalizePnlReport(report);

    // Map expense categories to Schedule C lines.
    const byLine = new Map<
      string,
      { line: string; label: string; amount: number; categories: Set<string> }
    >();
    for (const row of pnl.byCategory) {
      if (row.classification !== 'COGS' && row.classification !== 'OPERATING') continue;
      const scLine = scheduleCLineForCategory(row.name, row.classification);
      const key = scLine.line;
      let agg = byLine.get(key);
      if (!agg) {
        agg = { line: scLine.line, label: scLine.label, amount: 0, categories: new Set() };
        byLine.set(key, agg);
      }
      agg.amount += row.amount;
      agg.categories.add(row.name);
    }

    const lines = Array.from(byLine.values())
      .map((l) => ({ ...l, categories: Array.from(l.categories) }))
      .sort((a, b) =>
        a.line === LINE_COGS.line ? -1 : b.line === LINE_COGS.line ? 1 : b.amount - a.amount
      );

    return {
      year: input.year,
      grossReceipts: pnl.revenue,
      returnsAndAllowances: pnl.refunds,
      netReceipts: pnl.revenue - pnl.refunds,
      cogs: pnl.cogs,
      grossProfit: pnl.revenue - pnl.refunds - pnl.cogs,
      totalExpenses: pnl.operatingExpenses,
      tentativeProfit: pnl.revenue - pnl.refunds - pnl.cogs - pnl.operatingExpenses,
      lines,
      disclaimer:
        'Cash-basis summary generated from transaction classifications. Review with a tax preparer before filing.',
    };
  }),
});
