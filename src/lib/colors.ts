// Centralized color constants for Local Budget
// Recharts needs hex colors (can't use CSS variables), so we define them here
// and keep them in sync with globals.css theme variables.

export const CHART_COLORS = {
  income: '#2d9b6e',    // --income: forest green
  expense: '#d94040',   // --expense: warm red
  primary: '#4e8a6e',   // --primary: sage green
  slate: '#6b7f8e',
  amber: '#d4952a',
  purple: '#8562b5',
  teal: '#2d8a8a',
  rose: '#c4507a',
};

/** Ordered palette for multi-series charts (pie, bar, etc.) */
export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.income,
  CHART_COLORS.amber,
  CHART_COLORS.expense,
  CHART_COLORS.purple,
  CHART_COLORS.teal,
  CHART_COLORS.rose,
  CHART_COLORS.slate,
];

/** Classification badge styles — used on categories, rules, reports, review pages */
export const CLASSIFICATION_STYLES: Record<string, string> = {
  INCOME: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COGS: 'bg-amber-50 text-amber-700 border-amber-200',
  OPERATING: 'bg-sky-50 text-sky-700 border-sky-200',
  PERSONAL: 'bg-violet-50 text-violet-700 border-violet-200',
  TRANSFER: 'bg-slate-50 text-slate-700 border-slate-200',
  REIMBURSABLE: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  REIMBURSEMENT: 'bg-teal-50 text-teal-700 border-teal-200',
};

/** Account type icon background colors */
export const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  CHECKING: 'bg-sky-600',
  SAVINGS: 'bg-emerald-600',
  CREDIT_CARD: 'bg-violet-600',
  CASH: 'bg-amber-600',
  INVESTMENT: 'bg-teal-600',
  default: 'bg-slate-600',
};

/** Category bar colors for dashboard breakdown charts */
export const CATEGORY_BAR_COLORS = [
  'bg-[#4e8a6e]',
  'bg-[#2d9b6e]',
  'bg-[#d4952a]',
  'bg-[#d94040]',
  'bg-[#8562b5]',
  'bg-[#2d8a8a]',
  'bg-[#c4507a]',
  'bg-[#6b7f8e]',
];
