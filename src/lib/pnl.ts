import type { PrismaClient } from '@prisma/client';

/**
 * Profit & loss aggregation shared by the integration API and reports.
 * The classification method matches the one local-effort-app's
 * generate-local-budget-pnl.cjs uses: explicit transaction classification,
 * falling back to the category's default classification, then the
 * transaction type.
 */

export type EffectiveClassification =
  | 'INCOME'
  | 'REIMBURSEMENT'
  | 'COGS'
  | 'OPERATING'
  | 'REIMBURSABLE'
  | 'PERSONAL'
  | 'TRANSFER';

type ClassifiableTransaction = {
  classification?: string | null;
  type?: string | null;
  category?: { defaultClassification?: string | null } | null;
};

export function getEffectiveClassification(tx: ClassifiableTransaction): EffectiveClassification {
  if (tx.classification) return tx.classification as EffectiveClassification;
  if (tx.category?.defaultClassification) {
    return tx.category.defaultClassification as EffectiveClassification;
  }
  if (tx.type === 'INCOME') return 'INCOME';
  if (tx.type === 'TRANSFER') return 'TRANSFER';
  return 'PERSONAL';
}

export type PnlCategoryRow = {
  categoryId: string | null;
  name: string;
  classification: EffectiveClassification;
  amount: number;
  transactionCount: number;
};

export type PnlReport = {
  year: number;
  startDate: string;
  endDate: string;
  revenue: number;
  reimbursementIncome: number;
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpenses: number;
  netBusinessIncome: number;
  reimbursableExpenses: number;
  personalExpenses: number;
  uncategorizedAmount: number;
  uncategorizedCount: number;
  totalTransactionsInPeriod: number;
  totalLinesConsidered: number;
  transferLineCount: number;
  byCategory: PnlCategoryRow[];
};

type MutablePnl = Omit<PnlReport, 'byCategory'> & {
  byCategory: Map<string, PnlCategoryRow>;
};

function blankReport(year: number): MutablePnl {
  return {
    year,
    startDate: '',
    endDate: '',
    revenue: 0,
    reimbursementIncome: 0,
    totalRevenue: 0,
    cogs: 0,
    grossProfit: 0,
    grossMargin: 0,
    operatingExpenses: 0,
    netBusinessIncome: 0,
    reimbursableExpenses: 0,
    personalExpenses: 0,
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
  categoryName: string
): void {
  if (classification === 'TRANSFER') return;

  const absAmount = Math.abs(Number(amount || 0));
  report.totalLinesConsidered += 1;

  if (classification === 'INCOME') {
    report.revenue += absAmount;
  } else if (classification === 'REIMBURSEMENT') {
    report.reimbursementIncome += absAmount;
  } else if (classification === 'COGS') {
    report.cogs += absAmount;
  } else if (classification === 'OPERATING') {
    report.operatingExpenses += absAmount;
  } else if (classification === 'REIMBURSABLE') {
    report.reimbursableExpenses += absAmount;
  } else {
    report.personalExpenses += absAmount;
  }

  const key = `${categoryId || 'uncategorized'}::${classification}`;
  let row = report.byCategory.get(key);
  if (!row) {
    row = {
      categoryId: categoryId || null,
      name: categoryName || 'Uncategorized',
      classification,
      amount: 0,
      transactionCount: 0,
    };
    report.byCategory.set(key, row);
  }
  row.amount += absAmount;
  row.transactionCount += 1;

  if (!categoryId) {
    report.uncategorizedAmount += absAmount;
    report.uncategorizedCount += 1;
  }
}

export async function buildPnlReport(db: PrismaClient, year: number): Promise<PnlReport> {
  const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

  const transactions = await db.transaction.findMany({
    where: { date: { gte: startDate, lte: endDate } },
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
  report.totalTransactionsInPeriod = transactions.length;

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
        applyPnlLine(report, Number(split.amount), splitClassification, splitCategoryId, splitCategoryName);
      }
      continue;
    }

    applyPnlLine(
      report,
      Number(tx.amount),
      txClassification,
      tx.categoryId || null,
      tx.category?.name || 'Uncategorized'
    );
  }

  report.totalRevenue = report.revenue + report.reimbursementIncome;
  report.grossProfit = report.totalRevenue - report.cogs;
  report.grossMargin = report.totalRevenue > 0 ? (report.grossProfit / report.totalRevenue) * 100 : 0;
  report.netBusinessIncome = report.totalRevenue - report.cogs - report.operatingExpenses;

  return {
    ...report,
    byCategory: Array.from(report.byCategory.values()).sort((a, b) => b.amount - a.amount),
  };
}
