import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';
import {
  buildCashflowMonths,
  CASHFLOW_CONTRACT_VERSION,
  CASHFLOW_METHOD_VERSION,
  CASHFLOW_CONTRACT_VERSION_V2,
  CASHFLOW_METHOD_VERSION_V2,
  type CashflowMonth,
} from '@/lib/cashflow';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.INTEGRATION_API_TOKEN, 'INTEGRATION_API_TOKEN');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const grain = req.nextUrl.searchParams.get('grain') ?? 'month';
  if (!validDate(from) || !validDate(to) || from >= to) {
    return NextResponse.json({ error: 'from and to must be valid ISO dates with from < to' }, { status: 400 });
  }
  if (grain !== 'month') {
    return NextResponse.json({ error: 'Only grain=month is supported' }, { status: 400 });
  }
  const contractParam = req.nextUrl.searchParams.get('contract') ?? '1';
  if (contractParam !== '1' && contractParam !== '2') {
    return NextResponse.json({ error: 'contract must be 1 or 2' }, { status: 400 });
  }
  const contract = Number(contractParam);

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
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
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
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

  const generatedAt = new Date();
  const sourceMaxDate = source._max.date?.toISOString().slice(0, 10) ?? null;
  const latestBankSyncAt = latestBankSync._max.lastSyncedAt?.toISOString() ?? null;
  const result = buildCashflowMonths({
    transactions,
    from,
    toExclusive: to,
    sourceMaxDate,
    pendingDates: pendingRows.map((row) => row.date),
  });
  const pendingTransactionCount = pendingRows.length;
  const warnings: string[] = [];
  if (result.unclassifiedTransactionCount > 0) {
    warnings.push(`${result.unclassifiedTransactionCount} posted transactions contain unclassified outflow`);
  }
  if (result.splitMismatchCount > 0) {
    warnings.push(`${result.splitMismatchCount} split transactions do not reconcile within one cent`);
  }
  if (!latestBankSyncAt) {
    warnings.push('No bank sync timestamp is available');
  } else if (generatedAt.getTime() - new Date(latestBankSyncAt).getTime() > 48 * 60 * 60 * 1000) {
    warnings.push('Latest bank sync is more than 48 hours old');
  }

  // Contract v1 responses must stay byte-compatible: project away v2 fields.
  const months =
    contract === 2
      ? result.months
      : result.months.map(
          ({ founderDraws, pendingTransactionCount: _pending, isCompleteMonth, ...v1Month }) =>
            v1Month satisfies Partial<CashflowMonth>
        );

  return NextResponse.json({
    contractVersion: contract === 2 ? CASHFLOW_CONTRACT_VERSION_V2 : CASHFLOW_CONTRACT_VERSION,
    methodVersion: contract === 2 ? CASHFLOW_METHOD_VERSION_V2 : CASHFLOW_METHOD_VERSION,
    currency: 'USD',
    timezone: 'America/Chicago',
    generatedAt: generatedAt.toISOString(),
    sourceMaxDate,
    range: {
      from,
      toExclusive: to,
      completeMonthsOnly: result.months.every((month) => month.complete),
    },
    months,
    quality: {
      unclassifiedTransactionCount: result.unclassifiedTransactionCount,
      unclassifiedCents: result.unclassifiedCents,
      splitMismatchCount: result.splitMismatchCount,
      pendingTransactionCount,
      latestBankSyncAt,
      warnings,
    },
  });
}
