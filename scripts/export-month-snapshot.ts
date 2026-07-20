/**
 * Emit an aggregates-only snapshot of one closed month's cash actuals, safe to
 * commit to a public repo for secretless consumers (chat sessions, the
 * le-economist raise-evaluation pipeline).
 *
 * Hard sanitization rules:
 *   - integer cents, aggregates only — no transaction rows;
 *   - no customer names, emails, or Square customer IDs;
 *   - no account numbers or bank descriptors.
 * Anything deliberately unpublished is listed under `omittedFields` so a
 * consumer can tell a deliberate gap from missing data.
 *
 * Usage:
 *   npm run snapshot:export                       # last complete calendar month, stdout
 *   npm run snapshot:export -- --month=2026-06    # specific month
 *   npm run snapshot:export -- --out=path.json    # also write to a file
 *   npm run snapshot:export -- --force            # emit even if the month is incomplete
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  buildCashflowMonths,
  CASHFLOW_CONTRACT_VERSION_V2,
  CASHFLOW_METHOD_VERSION_V2,
} from '../src/lib/cashflow';

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

async function main() {
  const month = argValue('month') ?? lastCompleteMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month must be YYYY-MM, got ${month}`);
  const outPath = argValue('out');
  const force = process.argv.includes('--force');

  const from = `${month}-01`;
  const [year, monthNum] = month.split('-').map(Number);
  const toExclusive = new Date(Date.UTC(year, monthNum, 1)).toISOString().slice(0, 10);
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${toExclusive}T00:00:00.000Z`);

  const [transactions, pendingRows, source, latestBankSync] = await Promise.all([
    db.transaction.findMany({
      where: { status: 'POSTED', date: { gte: start, lt: end } },
      select: {
        id: true,
        date: true,
        amount: true,
        type: true,
        status: true,
        description: true,
        merchantName: true,
        classification: true,
        incurredBy: { select: { name: true } },
        category: { select: { id: true, name: true, defaultClassification: true } },
        splits: {
          select: {
            id: true,
            amount: true,
            classification: true,
            category: { select: { id: true, name: true, defaultClassification: true } },
          },
        },
      },
    }),
    db.transaction.findMany({
      where: { status: 'PENDING', date: { gte: start, lt: end } },
      select: { date: true },
    }),
    db.transaction.aggregate({ where: { status: 'POSTED' }, _max: { date: true } }),
    db.financialAccount.aggregate({
      where: { isActive: true, plaidAccountId: { not: null } },
      _max: { lastSyncedAt: true },
    }),
  ]);

  const sourceMaxDate = source._max.date?.toISOString().slice(0, 10) ?? null;
  const result = buildCashflowMonths({
    transactions,
    from,
    toExclusive,
    sourceMaxDate,
    pendingDates: pendingRows.map((row) => row.date),
  });
  const row = result.months[0];
  if (!row) throw new Error(`No month row produced for ${month}`);

  if (!row.isCompleteMonth && !force) {
    throw new Error(
      `${month} is not a complete month (sourceMaxDate=${sourceMaxDate}, ` +
        `pending=${row.pendingTransactionCount}). Re-run with --force to emit anyway; ` +
        `the snapshot will carry isCompleteMonth=false.`
    );
  }

  const { founderDraws, pendingTransactionCount, isCompleteMonth, complete, month: _m, ...totals } = row;

  const snapshot = {
    artifact: 'local-budget-month-snapshot',
    contractVersion: CASHFLOW_CONTRACT_VERSION_V2,
    methodVersion: CASHFLOW_METHOD_VERSION_V2,
    currency: 'USD',
    timezone: 'America/Chicago',
    generatedAt: new Date().toISOString(),
    month,
    isCompleteMonth,
    sourceMaxDate,
    latestBankSyncAt: latestBankSync._max.lastSyncedAt?.toISOString() ?? null,
    totals,
    founderDraws,
    quality: {
      pendingTransactionCount,
      unclassifiedTransactionCount: result.unclassifiedTransactionCount,
      splitMismatchCount: result.splitMismatchCount,
    },
    sanitization:
      'Aggregates only, integer cents. No transaction rows, customer identities, or account/bank descriptors.',
    omittedFields: [
      { field: 'transactions', reason: 'row-level data is never published' },
      { field: 'customers', reason: 'names, emails, and Square customer IDs are never published' },
      { field: 'accounts', reason: 'account numbers and bank descriptors are never published' },
      { field: 'vendorBreakdown', reason: 'per-vendor spend stays behind the authenticated /v1/vendors API' },
    ],
  };

  const json = JSON.stringify(snapshot, null, 2);
  if (outPath) {
    writeFileSync(outPath, `${json}\n`);
    console.error(`Wrote ${outPath}`);
  }
  console.log(json);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
