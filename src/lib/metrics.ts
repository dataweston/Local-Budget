/**
 * Centralized metric definitions for Local Budget.
 *
 * Every financial metric the app computes is defined here with:
 *   - a pure computation function
 *   - human-readable label, description, and format
 *
 * Dashboard, reports, and any future analytics should import from here
 * instead of computing inline.
 */

// ── helpers ──────────────────────────────────────────────────────────

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

// ── metric input types ───────────────────────────────────────────────

export interface PeriodTotals {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  personalExpenses: number;
  totalExpenses: number; // all non-transfer outflows
}

export interface CashPosition {
  currentBalance: number;       // total liquid balance across accounts
  monthlyBurnRate: number;      // average monthly total outflow
  monthlyOperatingBurn: number; // average monthly operating outflow (excl. personal)
}

export interface TrendInput {
  current: number;
  previous: number;
}

export interface AccountsReceivable {
  totalOutstanding: number;  // unpaid invoices
  revenuePeriod: number;     // revenue in the same period
  daysInPeriod: number;
}

// ── core P&L metrics ─────────────────────────────────────────────────

export function grossProfit(t: Pick<PeriodTotals, 'revenue' | 'cogs'>): number {
  return t.revenue - t.cogs;
}

export function grossMargin(t: Pick<PeriodTotals, 'revenue' | 'cogs'>): number {
  return pct(grossProfit(t), t.revenue);
}

export function operatingIncome(t: Pick<PeriodTotals, 'revenue' | 'cogs' | 'operatingExpenses'>): number {
  return grossProfit(t) - t.operatingExpenses;
}

export function operatingMargin(t: Pick<PeriodTotals, 'revenue' | 'cogs' | 'operatingExpenses'>): number {
  return pct(operatingIncome(t), t.revenue);
}

export function netIncome(t: PeriodTotals): number {
  return t.revenue - t.cogs - t.operatingExpenses - t.personalExpenses;
}

export function netMargin(t: PeriodTotals): number {
  return pct(netIncome(t), t.revenue);
}

// ── expense ratios ───────────────────────────────────────────────────

/** COGS as a percentage of revenue */
export function cogsRatio(t: Pick<PeriodTotals, 'revenue' | 'cogs'>): number {
  return pct(t.cogs, t.revenue);
}

/** Operating expenses as a percentage of revenue */
export function opexRatio(t: Pick<PeriodTotals, 'revenue' | 'operatingExpenses'>): number {
  return pct(t.operatingExpenses, t.revenue);
}

// ── cash & runway ────────────────────────────────────────────────────

/**
 * Cash runway in months — how long current cash lasts at current burn rate.
 * Uses operating burn (excludes personal draws) for business context.
 */
export function cashRunwayMonths(c: CashPosition): number {
  if (c.monthlyOperatingBurn <= 0) return Infinity;
  return c.currentBalance / c.monthlyOperatingBurn;
}

/** Savings rate: (income - expenses) / income */
export function savingsRate(income: number, expenses: number): number {
  return pct(income - expenses, income);
}

// ── trends ───────────────────────────────────────────────────────────

/** Period-over-period percentage change */
export function trend({ current, previous }: TrendInput): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// ── receivables (future, when invoicing exists) ──────────────────────

/** Days Sales Outstanding — average days to collect payment */
export function daysSalesOutstanding(ar: AccountsReceivable): number {
  return safeDivide(ar.totalOutstanding, ar.revenuePeriod) * ar.daysInPeriod;
}

// ── metric registry (for UI rendering) ───────────────────────────────

export type MetricFormat = 'currency' | 'percent' | 'number' | 'months';

export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  format: MetricFormat;
  /** positive = good (green) when true; lower = better when false */
  higherIsBetter: boolean;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    description: 'Total income from all sources (excluding transfers)',
    format: 'currency',
    higherIsBetter: true,
  },
  {
    key: 'grossProfit',
    label: 'Gross Profit',
    description: 'Revenue minus Cost of Goods Sold',
    format: 'currency',
    higherIsBetter: true,
  },
  {
    key: 'grossMargin',
    label: 'Gross Margin',
    description: 'Gross Profit as a percentage of Revenue',
    format: 'percent',
    higherIsBetter: true,
  },
  {
    key: 'operatingIncome',
    label: 'Operating Income',
    description: 'Gross Profit minus Operating Expenses (EBIT for small business)',
    format: 'currency',
    higherIsBetter: true,
  },
  {
    key: 'operatingMargin',
    label: 'Operating Margin',
    description: 'Operating Income as a percentage of Revenue',
    format: 'percent',
    higherIsBetter: true,
  },
  {
    key: 'netIncome',
    label: 'Net Income',
    description: 'Revenue minus all expenses (COGS + Operating + Personal)',
    format: 'currency',
    higherIsBetter: true,
  },
  {
    key: 'netMargin',
    label: 'Net Margin',
    description: 'Net Income as a percentage of Revenue',
    format: 'percent',
    higherIsBetter: true,
  },
  {
    key: 'cogsRatio',
    label: 'COGS Ratio',
    description: 'Cost of Goods Sold as a percentage of Revenue',
    format: 'percent',
    higherIsBetter: false,
  },
  {
    key: 'opexRatio',
    label: 'OpEx Ratio',
    description: 'Operating Expenses as a percentage of Revenue',
    format: 'percent',
    higherIsBetter: false,
  },
  {
    key: 'savingsRate',
    label: 'Savings Rate',
    description: 'Percentage of income retained after all expenses',
    format: 'percent',
    higherIsBetter: true,
  },
  {
    key: 'cashRunway',
    label: 'Cash Runway',
    description: 'Months of operating expenses covered by current cash balance',
    format: 'months',
    higherIsBetter: true,
  },
];

// ── formatting helpers ───────────────────────────────────────────────

export function formatMetricValue(value: number, format: MetricFormat): string {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'months':
      if (!isFinite(value)) return '∞';
      return `${value.toFixed(1)} mo`;
    case 'number':
      return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }
}
