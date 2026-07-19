/**
 * Schedule C (Form 1040) line mapping for sole-proprietor reporting.
 *
 * Categories are mapped to Schedule C lines by name keywords; anything
 * unmatched lands on line 27a (Other expenses), which is legitimate — the IRS
 * expects an attached statement for it, and the report lists the categories
 * that fed it. COGS-classified spend maps to Part III (line 4 via line 38+)
 * regardless of category name.
 *
 * This is a reporting aid, not tax advice — review with a preparer before
 * filing.
 */

export type ScheduleCLine = {
  line: string;
  label: string;
};

const LINE_OTHER: ScheduleCLine = { line: '27a', label: 'Other expenses' };
export const LINE_COGS: ScheduleCLine = { line: '4', label: 'Cost of goods sold (Part III)' };

// Keyword → Schedule C line. First match wins; keys are matched
// case-insensitively against the category name.
const KEYWORD_LINES: [RegExp, ScheduleCLine][] = [
  [/advertis|marketing|promo/i, { line: '8', label: 'Advertising' }],
  [/car|vehicle|mileage|gas|fuel|parking/i, { line: '9', label: 'Car and truck expenses' }],
  [/commission|referral/i, { line: '10', label: 'Commissions and fees' }],
  [/contract|freelanc|1099|helper/i, { line: '11', label: 'Contract labor' }],
  [/insurance/i, { line: '15', label: 'Insurance (other than health)' }],
  [/interest|loan/i, { line: '16b', label: 'Interest (other)' }],
  [/legal|accounting|bookkeep|professional|attorney|cpa/i, { line: '17', label: 'Legal and professional services' }],
  [/office|software|subscription|saas|app|hosting|domain/i, { line: '18', label: 'Office expense' }],
  [/rent|lease|commissary|kitchen rental/i, { line: '20b', label: 'Rent — other business property' }],
  [/repair|maintenance/i, { line: '21', label: 'Repairs and maintenance' }],
  [/suppl|packaging|paper|equipment|smallware/i, { line: '22', label: 'Supplies' }],
  [/tax|license|permit|fee.*(gov|state|city)/i, { line: '23', label: 'Taxes and licenses' }],
  [/travel|lodging|hotel|airfare/i, { line: '24a', label: 'Travel' }],
  [/meal|dining|entertain/i, { line: '24b', label: 'Deductible meals' }],
  [/utilit|electric|water|internet|phone|cell/i, { line: '25', label: 'Utilities' }],
  [/wage|payroll|salar/i, { line: '26', label: 'Wages' }],
  [/processing|merchant fee|square fee|stripe|bank fee|service charge/i, { line: '27a', label: 'Other expenses' }],
];

export function scheduleCLineForCategory(
  categoryName: string | null,
  classification: string
): ScheduleCLine {
  if (classification === 'COGS') return LINE_COGS;
  if (!categoryName) return LINE_OTHER;
  for (const [pattern, line] of KEYWORD_LINES) {
    if (pattern.test(categoryName)) return line;
  }
  return LINE_OTHER;
}
