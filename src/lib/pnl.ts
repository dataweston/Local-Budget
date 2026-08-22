import type { PrismaClient } from '@prisma/client';
import {
  getEffectiveClassification as getEffectiveClassificationBase,
  type EffectiveClassification,
} from '@/lib/transaction-filters';
import { operatingReportScope } from '@/lib/reporting-scope';

/**
 * Profit & loss aggregation — the single source of truth shared by the
 * dashboard router, the integration API, and reports. The classification
 * method matches the one local-effort-app's generate-local-budget-pnl.cjs
 * uses: explicit transaction classification, falling back to the category's
 * default classification, then the transaction type.
 *
 * Unified semantics (decided 2026-07):
 *   - Contra-revenue: an EXPENSE-typed line whose effective classification is
 *     INCOME (e.g. a Square refund) is netted AGAINST revenue, not booked as
 *     an expense. `revenue` stays the gross figure; `refunds` carries the
 *     contra total; `totalRevenue` is net of refunds.
 *   - Reimbursable expenses are money fronted to be paid back — they are NOT
 *     business operating cost, so they are excluded from operating income and
 *     reported separately.
 *   - Personal spending never enters business net income; it only appears in
 *     `netCashFlow` (what's left after everything, including personal).
 *   - Unclassified outflows (nobody has decided business vs personal) are their
 *     own bucket. They are excluded from the business income lines — claiming
 *     them either way would be a guess — but counted in totalExpenses and
 *     netCashFlow, because the cash did leave.
 */

export type { EffectiveClassification };

export const getEffectiveClassification = getEffectiveClassificationBase;

export type Direction = 'outflow' | 'inflow' | 'transfer';

/**
 * Money direction derived from the effective classification. TRANSFER is its
 * own bucket — it is internal movement, not a payment, so it is neither an
 * outflow nor an inflow. The brain's payment.completed consumers want
 * direction=outflow (vendor payments) and must never see transfers as payments.
 */
export function directionFor(classification: EffectiveClassification): Direction {
  switch (classification) {
    case 'INCOME':
    case 'REIMBURSEMENT':
      return 'inflow';
    case 'TRANSFER':
      return 'transfer';
    default:
      // COGS, OPERATING, REIMBURSABLE, PERSONAL, UNCLASSIFIED — money leaving
      // the business. An undecided expense is still cash out the door, so it
      // keeps its direction even though its bucket is unknown.
      return 'outflow';
  }
}

/**
 * The seeded catch-all category carries no more information than having no
 * category at all, but it is stored differently (a real row vs a NULL). Left
 * alone the two shapes produce two separate report lines with the identical
 * label "Uncategorized". Reporting collapses them into one bucket.
 */
export const UNCATEGORIZED_CATEGORY_NAME = 'Uncategorized';

export function isUncategorized(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined
): boolean {
  return !categoryId || categoryName === UNCATEGORIZED_CATEGORY_NAME;
}

/**
 * Distinct label per uncategorized bucket. Uncategorized lines are split by
 * classification, so without this every split renders as the same word and the
 * breakdown appears to list "Uncategorized" several times for no visible reason.
 */
export function uncategorizedLabel(classification: EffectiveClassification): string {
  switch (classification) {
    case 'INCOME':
      return 'Uncategorized income';
    case 'PERSONAL':
      return 'Uncategorized personal';
    case 'COGS':
      return 'Uncategorized COGS';
    case 'OPERATING':
      return 'Uncategorized operating';
    case 'REIMBURSABLE':
      return 'Uncategorized reimbursable';
    case 'REIMBURSEMENT':
      return 'Uncategorized reimbursement';
    case 'TRANSFER':
      return 'Uncategorized transfer';
    case 'UNCLASSIFIED':
      return 'Uncategorized (needs review)';
  }
}

export type PnlCategoryRow = {
  categoryId: string | null;
  name: string;
  classification: EffectiveClassification;
  amount: number;
  transactionCount: number;
};

export type PnlTotals = {
  revenue: number;
  refunds: number;
  reimbursementIncome: number;
  cogs: number;
  operatingExpenses: number;
  reimbursableExpenses: number;
  personalExpenses: number;
  /**
   * Outflows nobody has classified yet. Held apart from personalExpenses so an
   * un-triaged expense is never silently booked as owner spending; it is real
   * cash out, so it still counts toward totalExpenses and netCashFlow.
   */
  unclassifiedExpenses: number;
  unclassifiedCount: number;
  uncategorizedAmount: number;
  uncategorizedCount: number;
  totalTransactionsInPeriod: number;
  totalLinesConsidered: number;
  transferLineCount: number;
};

export type PnlDerived = {
  totalRevenue: number;
  grossProfit: number;
  grossMargin: number;
  operatingIncome: number;
  operatingMargin: number;
  netBusinessIncome: number;
  netMargin: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRate: number;
};

export type PnlReport = PnlTotals &
  PnlDerived & {
    year: number;
    startDate: string;
    endDate: string;
    byCategory: PnlCategoryRow[];
  };

export type MutablePnl = PnlTotals & {
  year: number;
  startDate: string;
  endDate: string;
  byCategory: Map<string, PnlCategoryRow>;
};

export function blankReport(year: number): MutablePnl {
  return {
    year,
    startDate: '',
    endDate: '',
    revenue: 0,
    refunds: 0,
    reimbursementIncome: 0,
    cogs: 0,
    operatingExpenses: 0,
    reimbursableExpenses: 0,
    personalExpenses: 0,
    unclassifiedExpenses: 0,
    unclassifiedCount: 0,
    uncategorizedAmount: 0,
    uncategorizedCount: 0,
    totalTransactionsInPeriod: 0,
    totalLinesConsidered: 0,
    transferLineCount: 0,
    byCategory: new Map(),
  };
}

export function applyPnlLine(
  report: MutablePnl,
  amount: number,
  classification: EffectiveClassification,
  categoryId: string | null,
  categoryName: string,
  opts?: { txType?: string | null }
): void {
  if (classification === 'TRANSFER') return;

  const absAmount = Math.abs(Number(amount || 0));
  report.totalLinesConsidered += 1;

  // Contra-revenue: an EXPENSE-typed line classified INCOME is a refund /
  // return netted against sales, not an expense.
  const isContraRevenue = classification === 'INCOME' && opts?.txType === 'EXPENSE';

  if (isContraRevenue) {
    report.refunds += absAmount;
  } else if (classification === 'INCOME') {
    report.revenue += absAmount;
  } else if (classification === 'REIMBURSEMENT') {
    report.reimbursementIncome += absAmount;
  } else if (classification === 'COGS') {
    report.cogs += absAmount;
  } else if (classification === 'OPERATING') {
    report.operatingExpenses += absAmount;
  } else if (classification === 'REIMBURSABLE') {
    report.reimbursableExpenses += absAmount;
  } else if (classification === 'UNCLASSIFIED') {
    report.unclassifiedExpenses += absAmount;
    report.unclassifiedCount += 1;
  } else {
    report.personalExpenses += absAmount;
  }

  // Collapse the seeded "Uncategorized" category into the no-category bucket so
  // the breakdown carries one line per meaning rather than one per storage shape.
  const uncategorized = isUncategorized(categoryId, categoryName);
  const rollupCategoryId = uncategorized ? null : categoryId;

  const key = `${rollupCategoryId || 'uncategorized'}::${classification}${isContraRevenue ? '::contra' : ''}`;
  let row = report.byCategory.get(key);
  if (!row) {
    row = {
      categoryId: rollupCategoryId,
      name: isContraRevenue && uncategorized
        ? 'Refunds'
        : uncategorized
          ? uncategorizedLabel(classification)
          : categoryName,
      classification,
      amount: 0,
      transactionCount: 0,
    };
    report.byCategory.set(key, row);
  }
  // Contra-revenue shows as a negative amount so category totals net correctly.
  row.amount += isContraRevenue ? -absAmount : absAmount;
  row.transactionCount += 1;

  if (uncategorized && !isContraRevenue) {
    report.uncategorizedAmount += absAmount;
    report.uncategorizedCount += 1;
  }
}

/** Derive the shared metric set from raw P&L totals. One definition, everywhere. */
export function derivePnlMetrics(t: PnlTotals): PnlDerived {
  const totalRevenue = t.revenue - t.refunds + t.reimbursementIncome;
  const grossProfit = totalRevenue - t.cogs;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const operatingIncome = grossProfit - t.operatingExpenses;
  const operatingMargin = totalRevenue > 0 ? (operatingIncome / totalRevenue) * 100 : 0;
  // Business net income: reimbursables and personal spend are excluded.
  const netBusinessIncome = operatingIncome;
  const netMargin = totalRevenue > 0 ? (netBusinessIncome / totalRevenue) * 100 : 0;
  // Unclassified outflows are real cash movement, so they belong in total
  // expenses and net cash flow — they are only withheld from the business
  // income lines above, where claiming them either way would be a guess.
  const totalExpenses =
    t.cogs +
    t.operatingExpenses +
    t.personalExpenses +
    t.reimbursableExpenses +
    t.unclassifiedExpenses;
  const netCashFlow = totalRevenue - totalExpenses;
  const savingsRate = totalRevenue > 0 ? (netCashFlow / totalRevenue) * 100 : 0;
  return {
    totalRevenue,
    grossProfit,
    grossMargin,
    operatingIncome,
    operatingMargin,
    netBusinessIncome,
    netMargin,
    totalExpenses,
    netCashFlow,
    savingsRate,
  };
}

type PnlTransactionShape = {
  amount: unknown;
  type: string | null;
  classification: string | null;
  categoryId: string | null;
  category: { id: string; name: string; defaultClassification: string | null } | null;
  splits: {
    amount: unknown;
    classification: string | null;
    category: { id: string; name: string; defaultClassification: string | null } | null;
  }[];
};

/**
 * Aggregate a set of transactions (with splits) into a mutable P&L. Shared by
 * the year-based integration report and the date-range dashboard endpoint.
 */
export function aggregatePnl(report: MutablePnl, transactions: PnlTransactionShape[]): void {
  report.totalTransactionsInPeriod += transactions.length;
  for (const tx of transactions) {
    const txClassification = getEffectiveClassification(tx);
    if (txClassification === 'TRANSFER' || tx.type === 'TRANSFER') {
      report.transferLineCount += 1;
    }

    if (tx.splits.length > 0) {
      for (const split of tx.splits) {
        const splitClassification = (split.classification ||
          split.category?.defaultClassification ||
          txClassification) as EffectiveClassification;
        const splitCategoryId = split.category?.id || tx.categoryId || null;
        const splitCategoryName = split.category?.name || tx.category?.name || 'Uncategorized';
        applyPnlLine(
          report,
          Number(split.amount),
          splitClassification,
          splitCategoryId,
          splitCategoryName,
          { txType: tx.type }
        );
      }
      continue;
    }

    applyPnlLine(
      report,
      Number(tx.amount),
      txClassification,
      tx.categoryId || null,
      tx.category?.name || 'Uncategorized',
      { txType: tx.type }
    );
  }
}

export function finalizePnlReport(report: MutablePnl): PnlReport {
  return {
    ...report,
    ...derivePnlMetrics(report),
    byCategory: Array.from(report.byCategory.values()).sort((a, b) => b.amount - a.amount),
  };
}

export async function buildPnlReport(db: PrismaClient, year: number): Promise<PnlReport> {
  const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

  const transactions = await db.transaction.findMany({
    where: {
      ...operatingReportScope(),
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
          category: { select: { id: true, name: true, defaultClassification: true } },
        },
      },
    },
    orderBy: { date: 'asc' },
  });

  const report = blankReport(year);
  report.startDate = startDate.toISOString();
  report.endDate = endDate.toISOString();

  aggregatePnl(report, transactions);

  return finalizePnlReport(report);
}
