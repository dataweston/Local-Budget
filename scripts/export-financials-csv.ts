/**
 * Monthly income statement + balance sheet as CSV, in the shape lenders ask for
 * (line items down, months across) — e.g. Wayflyer requires both statements
 * "on a monthly basis" covering the full requested period.
 *
 * The P&L is derived from the same @/lib/pnl aggregation the app reports from,
 * so the exported statement and the dashboard can never drift apart.
 *
 * The balance sheet is only as good as what this system tracks, which today is
 * cash accounts and nothing else. Rows the data cannot support are emitted as
 * "n/a (not tracked)" rather than 0 — a zero would read as an assertion that
 * the business has no debt and no inventory, which is not true. See the
 * data-quality block printed to stderr.
 *
 * Usage:
 *   npm run export:financials                        # 12 months to last complete month
 *   npm run export:financials -- --months=6
 *   npm run export:financials -- --end=2026-07
 *   npm run export:financials -- --outdir=./exports
 */
import './load-env';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  blankReport,
  aggregatePnl,
  derivePnlMetrics,
  type PnlCategoryRow,
} from '../src/lib/pnl';

const db = new PrismaClient();

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

function lastCompleteMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

/** Inclusive list of YYYY-MM keys ending at `end`, `count` long. */
function monthKeys(end: string, count: number): string[] {
  const [y, m] = end.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  }
  return keys;
}

function monthStart(key: string): Date {
  return new Date(`${key}-01T00:00:00.000Z`);
}

function monthEndExclusive(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1));
}

function csvCell(value: string | number): string {
  const s = typeof value === 'number' ? value.toFixed(2) : value;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

const NOT_TRACKED = 'n/a (not tracked)';

type MonthPnl = {
  key: string;
  totals: ReturnType<typeof derivePnlMetrics> & {
    revenue: number;
    refunds: number;
    reimbursementIncome: number;
    cogs: number;
    operatingExpenses: number;
    reimbursableExpenses: number;
    personalExpenses: number;
    unclassifiedExpenses: number;
  };
  byCategory: PnlCategoryRow[];
};

async function main() {
  const end = argValue('end') ?? lastCompleteMonth();
  if (!/^\d{4}-\d{2}$/.test(end)) throw new Error(`--end must be YYYY-MM, got ${end}`);
  const months = Number(argValue('months') ?? 12);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    throw new Error(`--months must be 1..60, got ${months}`);
  }
  const outdir = argValue('outdir') ?? 'exports';
  const keys = monthKeys(end, months);

  const windowStart = monthStart(keys[0]);
  const windowEnd = monthEndExclusive(keys[keys.length - 1]);

  const transactions = await db.transaction.findMany({
    where: { date: { gte: windowStart, lt: windowEnd } },
    select: {
      date: true,
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

  // ── P&L, one aggregation per month ─────────────────────────────────────
  const byMonth = new Map<string, typeof transactions>();
  for (const key of keys) byMonth.set(key, []);
  for (const tx of transactions) {
    const key = tx.date.toISOString().slice(0, 7);
    byMonth.get(key)?.push(tx);
  }

  const pnls: MonthPnl[] = keys.map((key) => {
    const report = blankReport(Number(key.slice(0, 4)));
    aggregatePnl(report, byMonth.get(key) ?? []);
    const derived = derivePnlMetrics(report);
    return {
      key,
      totals: { ...derived, ...report },
      byCategory: Array.from(report.byCategory.values()),
    };
  });

  const catsFor = (cls: string): string[] => {
    const names = new Set<string>();
    for (const p of pnls) {
      for (const row of p.byCategory) {
        if (row.classification === cls) names.add(row.name);
      }
    }
    return Array.from(names).sort();
  };

  const amountFor = (p: MonthPnl, cls: string, name: string): number =>
    p.byCategory
      .filter((r) => r.classification === cls && r.name === name)
      .reduce((s, r) => s + r.amount, 0);

  const header = ['Line item', ...keys, 'Total'];
  const total = (fn: (p: MonthPnl) => number): number => pnls.reduce((s, p) => s + fn(p), 0);
  const line = (label: string, fn: (p: MonthPnl) => number): (string | number)[] => [
    label,
    ...pnls.map(fn),
    total(fn),
  ];
  const blank = (): (string | number)[] => [''];

  // Standard presentation: reimbursements are OTHER income, below operating
  // income — never folded into sales. (The app's internal `totalRevenue` does
  // fold them in; doing that on a lender-facing statement would present a tax
  // refund as trading revenue. Reconciliation note is emitted at the bottom.)
  const netRevenue = (p: MonthPnl) => p.totals.revenue - p.totals.refunds;
  const grossProfit = (p: MonthPnl) => netRevenue(p) - p.totals.cogs;
  const operatingIncome = (p: MonthPnl) => grossProfit(p) - p.totals.operatingExpenses;
  const netIncome = (p: MonthPnl) => operatingIncome(p) + p.totals.reimbursementIncome;

  const pnlRows: (string | number)[][] = [
    ['Local Effort — Income Statement'],
    [`Period: ${keys[0]} to ${keys[keys.length - 1]} (monthly)`],
    [`Generated: ${new Date().toISOString().slice(0, 10)}  |  Currency: USD  |  Basis: cash`],
    blank(),
    header,
    ['REVENUE'],
    line('  Gross revenue', (p) => p.totals.revenue),
    line('  Less: refunds and returns', (p) => -p.totals.refunds),
    line('NET REVENUE', netRevenue),
    blank(),
    ['COST OF GOODS SOLD'],
    ...catsFor('COGS').map((n) => line(`  ${n}`, (p) => amountFor(p, 'COGS', n))),
    line('Total COGS', (p) => p.totals.cogs),
    blank(),
    line('GROSS PROFIT', grossProfit),
    blank(),
    ['OPERATING EXPENSES'],
    ...catsFor('OPERATING').map((n) => line(`  ${n}`, (p) => amountFor(p, 'OPERATING', n))),
    line('Total operating expenses', (p) => p.totals.operatingExpenses),
    blank(),
    line('OPERATING INCOME', operatingIncome),
    blank(),
    ['OTHER INCOME (non-trading — excluded from net revenue)'],
    line('  Reimbursements and refunds received', (p) => p.totals.reimbursementIncome),
    blank(),
    line('NET INCOME', netIncome),
    blank(),
    ['OWNER AND UNRESOLVED ITEMS (excluded from the business result above)'],
    line('  Owner draws / personal', (p) => p.totals.personalExpenses),
    line('  Reimbursable expenses (recoverable)', (p) => p.totals.reimbursableExpenses),
    line('  Unclassified — pending review', (p) => p.totals.unclassifiedExpenses),
    blank(),
    line('NET CASH FLOW (after all outflows incl. owner draws)', (p) => p.totals.netCashFlow),
    blank(),
    ['NOTES'],
    ['1. Cash basis. Figures derive from posted bank and Square activity.'],
    ['2. "Other income" is non-trading receipts (reimbursements, tax refunds) and is deliberately excluded from net revenue.'],
    ['3. Owner draws are excluded from the business result and shown separately.'],
    ['4. "Unclassified" is spend not yet assigned to business or personal; it is excluded from the business result rather than assumed either way.'],
  ];

  // ── Balance sheet ──────────────────────────────────────────────────────
  // Only cash accounts exist in this system, and only as a CURRENT balance, so
  // month-end cash is reconstructed by unwinding activity after each month end.
  const accounts = await db.financialAccount.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true, currentBalance: true, lastSyncedAt: true },
    orderBy: { name: 'asc' },
  });

  const ASSET_TYPES = ['CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT', 'OTHER'];
  const LIABILITY_TYPES = ['CREDIT_CARD', 'LOAN'];
  const liabilityAccounts = accounts.filter((a) => LIABILITY_TYPES.includes(a.type));
  const assetAccounts = accounts.filter((a) => ASSET_TYPES.includes(a.type));

  // Signed cash effect: amounts are stored positive, `type` carries direction.
  // TRANSFER direction is not recoverable from a single row, so those are
  // counted separately and reported as an accuracy caveat rather than guessed.
  const after = await db.transaction.findMany({
    where: { date: { gte: windowStart } },
    select: { accountId: true, date: true, amount: true, type: true },
  });

  const transferRowsInWindow = after.filter((t) => t.type === 'TRANSFER').length;

  function balanceAtEnd(accountId: string, current: number, endExclusive: Date): number {
    let net = 0;
    for (const t of after) {
      if (t.accountId !== accountId || t.date < endExclusive) continue;
      if (t.type === 'INCOME') net += Number(t.amount);
      else if (t.type === 'EXPENSE') net -= Number(t.amount);
    }
    return current - net;
  }

  const monthEndCash = new Map<string, number[]>();
  for (const acct of assetAccounts) {
    monthEndCash.set(
      acct.id,
      keys.map((k) => balanceAtEnd(acct.id, Number(acct.currentBalance), monthEndExclusive(k)))
    );
  }

  // A cash asset account cannot hold a negative balance. Where the unwind
  // produces one, the reconstruction has failed for that account — typically an
  // unsynced balance (Square accounts report 0) or activity that predates the
  // window. Flag those instead of publishing a figure that looks authoritative.
  const unreliable = new Set(
    assetAccounts
      .filter((a) => (monthEndCash.get(a.id) ?? []).some((v) => v < -0.005))
      .map((a) => a.id)
  );

  const totalCash = keys.map((_, i) =>
    assetAccounts
      .filter((a) => !unreliable.has(a.id))
      .reduce((s, a) => s + (monthEndCash.get(a.id)?.[i] ?? 0), 0)
  );

  const bsHeader = ['Line item', ...keys];
  const naRow = (label: string): (string | number)[] => [label, ...keys.map(() => NOT_TRACKED)];

  const bsRows: (string | number)[][] = [
    ['Local Effort — Balance Sheet'],
    [`Period: ${keys[0]} to ${keys[keys.length - 1]} (month-end)`],
    [`Generated: ${new Date().toISOString().slice(0, 10)}  |  Currency: USD`],
    ['INCOMPLETE — cash only. See "Not tracked" rows and the notes at the bottom.'],
    blank(),
    bsHeader,
    ['ASSETS'],
    ...assetAccounts.map((a) =>
      unreliable.has(a.id)
        ? [`  ${a.name} (${a.type})`, ...keys.map(() => 'unreliable — see note 6')]
        : [`  ${a.name} (${a.type})`, ...(monthEndCash.get(a.id) ?? [])]
    ),
    [
      `Total cash and equivalents${unreliable.size ? ' (reliable accounts only)' : ''}`,
      ...totalCash,
    ],
    naRow('  Inventory'),
    naRow('  Accounts receivable'),
    naRow('  Fixed assets (vehicle, equipment)'),
    naRow('TOTAL ASSETS'),
    blank(),
    ['LIABILITIES'],
    ...(liabilityAccounts.length
      ? liabilityAccounts.map((a) => [`  ${a.name} (${a.type})`, ...keys.map(() => NOT_TRACKED)])
      : [naRow('  Credit cards (no such account exists in this system)')]),
    naRow('  Loans payable (Square Capital, auto finance)'),
    naRow('  Accounts payable'),
    naRow('TOTAL LIABILITIES'),
    blank(),
    ['EQUITY'],
    naRow("  Owner's equity / retained earnings"),
    naRow('TOTAL LIABILITIES AND EQUITY'),
    blank(),
    ['NOTES'],
    ['1. Cash balances are reconstructed by unwinding posted activity from the current balance.'],
    [`2. ${transferRowsInWindow} TRANSFER-type rows in this window carry no direction and are excluded from the reconstruction.`],
    ['3. No liability accounts exist in this system, so debt is absent — not zero. The Square Capital loan and the vehicle finance balance are both real and unrecorded.'],
    ['4. Inventory, receivables, payables and fixed assets are not tracked; totals are therefore not computable and are left blank rather than implied.'],
    ['5. All accounts belong to a single "Personal" entity; no business/personal separation exists at the account level.'],
    ...(unreliable.size
      ? [
          [
            `6. ${unreliable.size} account(s) reconstructed to an impossible negative cash balance and are excluded from the total: ` +
              assetAccounts.filter((a) => unreliable.has(a.id)).map((a) => a.name).join(', ') +
              '. Their current balance is stale (Square accounts report 0), so the unwind has no valid starting point.',
          ],
        ]
      : []),
  ];

  mkdirSync(outdir, { recursive: true });
  const pnlPath = join(outdir, `profit-and-loss_${keys[0]}_${keys[keys.length - 1]}.csv`);
  const bsPath = join(outdir, `balance-sheet_${keys[0]}_${keys[keys.length - 1]}.csv`);
  writeFileSync(pnlPath, toCsv(pnlRows));
  writeFileSync(bsPath, toCsv(bsRows));

  // ── operator-facing summary ────────────────────────────────────────────
  const netRev = total(netRevenue);
  const opIncome = total(operatingIncome);
  const otherIncome = total((p) => p.totals.reimbursementIncome);
  const unclassified = total((p) => p.totals.unclassifiedExpenses);
  const avgMonthly = netRev / months;

  console.error(`\nWrote:\n  ${pnlPath}\n  ${bsPath}\n`);
  console.error(`Period ${keys[0]}..${keys[keys.length - 1]} (${months} months)`);
  console.error(`  Net revenue          $${netRev.toFixed(2)}`);
  console.error(`  Other (non-trading)  $${otherIncome.toFixed(2)}`);
  console.error(`  Operating income     $${opIncome.toFixed(2)}`);
  console.error(`  Avg monthly revenue  $${avgMonthly.toFixed(2)}`);
  if (avgMonthly < 10000) {
    console.error(
      `  NOTE: below the $10,000/mo floor lenders such as Wayflyer require.\n` +
        `  Trading revenue only — non-trading receipts are correctly excluded.`
    );
  }
  if (unclassified > 0) {
    console.error(
      `\n  WARNING: $${unclassified.toFixed(2)} of spend is still unclassified and sits\n` +
        `  outside the business result. Triage it before sharing these statements.`
    );
  }
  console.error(
    `\n  The balance sheet is NOT lender-ready: no liability accounts, inventory,\n` +
      `  receivables or fixed assets exist in this system. See NOTES in the CSV.\n`
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
