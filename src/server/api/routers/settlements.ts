import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * Processor settlement reporting.
 *
 * Bank deposits are the revenue line, and they arrive net — the processor has
 * already taken its fee, applied refunds, and withheld any financing repayment
 * before the money lands. That makes the cost of card processing invisible in
 * the ledger the rest of the app reports on.
 *
 * These settlement entries are where that detail survives, so this router
 * exposes gross, fees, and refunds without changing what counts as revenue.
 */

const dateRange = z
  .object({
    startDate: z.date().optional(),
    endDate: z.date().optional(),
  })
  .optional();

/** Entry types that reduce the payout but are not a processing fee. */
const REFUND_TYPES = new Set(['REFUND']);
const FINANCING_TYPES = new Set([
  'SQUARE_CAPITAL_PAYMENT',
  'SQUARE_CAPITAL_REVERSED_PAYMENT',
]);

export const settlementsRouter = createTRPCRouter({
  /**
   * Gross receipts, processing fees, refunds, and financing withheld — in
   * total, by month, and by entry type.
   */
  feeSummary: protectedProcedure.input(dateRange).query(async ({ ctx, input }) => {
    const now = new Date();
    const startDate = input?.startDate ?? new Date(now.getFullYear(), 0, 1);
    const endDate = input?.endDate ?? now;

    const entries = await ctx.db.processorSettlementEntry.findMany({
      where: {
        isCurrent: true,
        settlement: {
          account: { userId: ctx.session.user.id },
          effectiveAt: { gte: startDate, lte: endDate },
        },
      },
      select: {
        type: true,
        grossAmount: true,
        feeAmount: true,
        netAmount: true,
        effectiveAt: true,
        settlement: { select: { effectiveAt: true, provider: true } },
      },
    });

    type Bucket = { gross: number; fees: number; refunds: number; financing: number; net: number; count: number };
    const empty = (): Bucket => ({ gross: 0, fees: 0, refunds: 0, financing: 0, net: 0, count: 0 });

    const totals = empty();
    const byMonth = new Map<string, Bucket>();
    const byType = new Map<string, { count: number; gross: number; fees: number }>();

    for (const entry of entries) {
      const gross = Number(entry.grossAmount);
      const fees = Number(entry.feeAmount);
      const net = Number(entry.netAmount);
      const month = (entry.effectiveAt ?? entry.settlement.effectiveAt).toISOString().slice(0, 7);

      const bucket = byMonth.get(month) ?? empty();
      for (const target of [totals, bucket]) {
        target.count += 1;
        target.fees += fees;
        target.net += net;
        // Deductions are stored as negative gross, so negate rather than take
        // the absolute value: a financing *reversal* posts positive and has to
        // reduce the withheld total, not add to it. Keeping the sign is what
        // makes gross - fees - refunds - financing tie back to net.
        if (REFUND_TYPES.has(entry.type)) target.refunds += -gross;
        else if (FINANCING_TYPES.has(entry.type)) target.financing += -gross;
        else target.gross += gross;
      }
      byMonth.set(month, bucket);

      const typeBucket = byType.get(entry.type) ?? { count: 0, gross: 0, fees: 0 };
      typeBucket.count += 1;
      typeBucket.gross += gross;
      typeBucket.fees += fees;
      byType.set(entry.type, typeBucket);
    }

    const rate = (fees: number, gross: number) => (gross > 0 ? (fees / gross) * 100 : 0);

    // How much of the payout total is actually tied to a bank deposit — the
    // fee figures are only as trustworthy as the settlements behind them.
    const settlementStatus = await ctx.db.processorSettlement.groupBy({
      by: ['reconciliationStatus'],
      where: {
        account: { userId: ctx.session.user.id },
        effectiveAt: { gte: startDate, lte: endDate },
      },
      _count: { _all: true },
    });

    return {
      range: { startDate, endDate },
      totals: { ...totals, feeRate: rate(totals.fees, totals.gross) },
      byMonth: Array.from(byMonth.entries())
        .map(([month, bucket]) => ({ month, ...bucket, feeRate: rate(bucket.fees, bucket.gross) }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byType: Array.from(byType.entries())
        .map(([type, bucket]) => ({ type, ...bucket }))
        .sort((a, b) => Math.abs(b.gross) - Math.abs(a.gross)),
      reconciliation: settlementStatus.map((row) => ({
        status: row.reconciliationStatus,
        count: row._count._all,
      })),
    };
  }),
});
