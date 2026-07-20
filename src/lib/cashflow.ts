import type { EffectiveClassification } from '@/lib/pnl';

export const CASHFLOW_CONTRACT_VERSION = 1;
export const CASHFLOW_METHOD_VERSION = 'cashflow-actuals-v1';
export const CASHFLOW_CONTRACT_VERSION_V2 = 2;
export const CASHFLOW_METHOD_VERSION_V2 = 'cashflow-actuals-v2';

export type CostBucket =
  | 'INVENTORY'
  | 'OPERATING'
  | 'LABOR'
  | 'EXCLUDED'
  | 'UNCLASSIFIED';

export type LaborSubcategory =
  | 'GROSS_WAGES'
  | 'EMPLOYER_TAX'
  | 'REIMBURSEMENT'
  | 'CONTRACTOR'
  | 'UNKNOWN';

type CategoryRef = {
  id?: string | null;
  name?: string | null;
  defaultClassification?: string | null;
} | null;

export type CashflowSplitInput = {
  id?: string;
  amount: unknown;
  classification?: string | null;
  category?: CategoryRef;
};

export type CashflowTransactionInput = {
  id: string;
  date: Date;
  amount: unknown;
  type: string;
  status: string;
  description?: string | null;
  merchantName?: string | null;
  classification?: string | null;
  category?: CategoryRef;
  incurredBy?: { name?: string | null } | null;
  splits: CashflowSplitInput[];
};

// PERSONAL outflows are owner/founder draws in these books. Attribution comes
// only from an explicitly linked incurredBy entity — never inferred, so
// `unattributedCents` stays truthful for the evaluation pipeline.
export type FounderDraws = {
  totalCents: number;
  byFounder: Record<string, number>;
  unattributedCents: number;
};

export type CashflowMonth = {
  month: string;
  incomeCents: number;
  inventoryCents: number;
  operatingCents: number;
  laborCents: number;
  reimbursableCents: number;
  personalExcludedCents: number;
  transferExcludedCents: number;
  unclassifiedCents: number;
  transactionCount: number;
  splitLineCount: number;
  complete: boolean;
  // v2 additions — projected away for contract-v1 responses.
  founderDraws: FounderDraws;
  pendingTransactionCount: number;
  isCompleteMonth: boolean;
};

const LABOR_CATEGORY = /(?:^|\b)(labor|payroll|wages?|contractors?|staff)(?:\b|$)/i;
const PAYROLL_MERCHANT = /(?:square|block)[\s-]*payroll/i;

export function dollarsToCents(amount: unknown): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new Error(`Invalid monetary amount: ${String(amount)}`);
  return Math.round(Math.abs(value) * 100);
}

export function effectiveCashflowClassification(
  line: { classification?: string | null; category?: CategoryRef },
  parent?: { classification?: string | null; category?: CategoryRef }
): EffectiveClassification | null {
  return (line.classification ??
    line.category?.defaultClassification ??
    parent?.classification ??
    parent?.category?.defaultClassification ??
    null) as EffectiveClassification | null;
}

export function laborSubcategoryFor(text: string): LaborSubcategory {
  if (/reimburs/i.test(text)) return 'REIMBURSEMENT';
  if (/(payroll[\s-]*tax|employer[\s-]*tax|fica|941\b)/i.test(text)) return 'EMPLOYER_TAX';
  if (/contractor|1099\b/i.test(text)) return 'CONTRACTOR';
  if (/gross[\s-]*wages?|salary|payroll/i.test(text)) return 'GROSS_WAGES';
  return 'UNKNOWN';
}

export function costBucketFor(input: {
  classification: EffectiveClassification | null;
  categoryName?: string | null;
  merchantName?: string | null;
  description?: string | null;
  type?: string | null;
}): { costBucket: CostBucket; costSubcategory: LaborSubcategory | 'UNKNOWN' | null } {
  const categoryName = input.categoryName ?? '';
  const evidence = `${categoryName} ${input.merchantName ?? ''} ${input.description ?? ''}`.trim();
  if (LABOR_CATEGORY.test(categoryName) || PAYROLL_MERCHANT.test(evidence)) {
    return { costBucket: 'LABOR', costSubcategory: laborSubcategoryFor(evidence) };
  }

  switch (input.classification) {
    case 'COGS':
      return { costBucket: 'INVENTORY', costSubcategory: 'UNKNOWN' };
    case 'OPERATING':
      return { costBucket: 'OPERATING', costSubcategory: null };
    case 'PERSONAL':
    case 'TRANSFER':
    case 'INCOME':
    case 'REIMBURSEMENT':
      return { costBucket: 'EXCLUDED', costSubcategory: null };
    case 'REIMBURSABLE':
      return { costBucket: 'OPERATING', costSubcategory: 'UNKNOWN' };
    default:
      return input.type === 'INCOME'
        ? { costBucket: 'EXCLUDED', costSubcategory: null }
        : { costBucket: 'UNCLASSIFIED', costSubcategory: null };
  }
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addMonth(dateText: string): string {
  const [year, month] = dateText.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function blankMonth(month: string, complete: boolean): CashflowMonth {
  return {
    month,
    incomeCents: 0,
    inventoryCents: 0,
    operatingCents: 0,
    laborCents: 0,
    reimbursableCents: 0,
    personalExcludedCents: 0,
    transferExcludedCents: 0,
    unclassifiedCents: 0,
    transactionCount: 0,
    splitLineCount: 0,
    complete,
    founderDraws: { totalCents: 0, byFounder: {}, unattributedCents: 0 },
    pendingTransactionCount: 0,
    isCompleteMonth: false,
  };
}

export function buildCashflowMonths(options: {
  transactions: CashflowTransactionInput[];
  from: string;
  toExclusive: string;
  sourceMaxDate: string | null;
  // Dates of PENDING imports in range; a month with any is not complete.
  pendingDates?: Date[];
}) {
  const months = new Map<string, CashflowMonth>();
  let cursor = `${options.from.slice(0, 7)}-01`;
  const sourceThrough = options.sourceMaxDate ?? '';
  while (cursor < options.toExclusive) {
    const next = addMonth(cursor);
    const fullyRequested = options.from <= cursor && options.toExclusive >= next;
    const sourceComplete = sourceThrough >= new Date(new Date(`${next}T00:00:00.000Z`).getTime() - 1)
      .toISOString()
      .slice(0, 10);
    months.set(cursor.slice(0, 7), blankMonth(cursor.slice(0, 7), fullyRequested && sourceComplete));
    cursor = next;
  }

  const unclassifiedTransactions = new Set<string>();
  let splitMismatchCount = 0;

  for (const tx of options.transactions) {
    if (tx.status !== 'POSTED') continue;
    const month = months.get(monthKey(tx.date));
    if (!month) continue;
    month.transactionCount += 1;

    const lines = tx.splits.length > 0 ? tx.splits : [tx];
    if (tx.splits.length > 0) {
      month.splitLineCount += tx.splits.length;
      const splitCents = tx.splits.reduce((sum, split) => sum + dollarsToCents(split.amount), 0);
      if (Math.abs(splitCents - dollarsToCents(tx.amount)) > 1) splitMismatchCount += 1;
    }

    for (const line of lines) {
      const classification = effectiveCashflowClassification(line, tx);
      const categoryName = line.category?.name ?? tx.category?.name ?? null;
      const { costBucket } = costBucketFor({
        classification,
        categoryName,
        merchantName: tx.merchantName,
        description: tx.description,
        type: tx.type,
      });
      const cents = dollarsToCents(line.amount);

      if (classification === 'INCOME' || (!classification && tx.type === 'INCOME')) {
        month.incomeCents += cents;
      } else if (classification === 'REIMBURSEMENT') {
        month.incomeCents += cents;
      } else if (costBucket === 'LABOR') {
        month.laborCents += cents;
      } else if (costBucket === 'INVENTORY') {
        month.inventoryCents += cents;
      } else if (classification === 'REIMBURSABLE') {
        month.reimbursableCents += cents;
      } else if (classification === 'PERSONAL') {
        month.personalExcludedCents += cents;
        if (tx.type === 'EXPENSE') {
          month.founderDraws.totalCents += cents;
          const founder = tx.incurredBy?.name?.trim();
          if (founder) {
            month.founderDraws.byFounder[founder] =
              (month.founderDraws.byFounder[founder] ?? 0) + cents;
          } else {
            month.founderDraws.unattributedCents += cents;
          }
        }
      } else if (classification === 'TRANSFER' || tx.type === 'TRANSFER') {
        month.transferExcludedCents += cents;
      } else if (costBucket === 'OPERATING') {
        month.operatingCents += cents;
      } else {
        month.unclassifiedCents += cents;
        unclassifiedTransactions.add(tx.id);
      }
    }
  }

  for (const pendingDate of options.pendingDates ?? []) {
    const month = months.get(monthKey(pendingDate));
    if (month) month.pendingTransactionCount += 1;
  }
  for (const month of Array.from(months.values())) {
    month.isCompleteMonth = month.complete && month.pendingTransactionCount === 0;
  }

  return {
    months: Array.from(months.values()),
    unclassifiedTransactionCount: unclassifiedTransactions.size,
    unclassifiedCents: Array.from(months.values()).reduce((sum, month) => sum + month.unclassifiedCents, 0),
    splitMismatchCount,
  };
}
