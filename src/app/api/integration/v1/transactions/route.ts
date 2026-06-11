import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';
import { getEffectiveClassification, type EffectiveClassification } from '@/lib/pnl';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;

type TransactionRow = {
  id: string;
  date: string;
  amount: number;
  type: string;
  status: string;
  description: string;
  merchantName: string | null;
  classification: string | null;
  effectiveClassification: EffectiveClassification;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string;
  accountName: string | null;
  externalId: string | null;
  splits: {
    amount: number;
    classification: string | null;
    categoryName: string | null;
  }[];
};

function toCsv(rows: TransactionRow[]): string {
  const headers = [
    'id',
    'date',
    'amount',
    'type',
    'status',
    'description',
    'merchantName',
    'classification',
    'effectiveClassification',
    'categoryName',
    'accountName',
    'externalId',
  ];
  const escape = (value: unknown) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h as keyof TransactionRow])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * GET /api/integration/v1/transactions
 *
 * Machine-readable transaction export for trusted consumers (the
 * local-effort-app brain). Bearer-token authenticated via
 * INTEGRATION_API_TOKEN.
 *
 * Query params:
 *   from, to          — ISO dates (inclusive)
 *   classification    — comma-separated effective classifications
 *                       (e.g. COGS,OPERATING); applied after category fallback
 *   merchant          — case-insensitive substring match on merchantName
 *   format            — json (default) | csv
 *   limit             — page size, default 500, max 2000
 *   cursor            — id of the last row of the previous page
 */
export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.INTEGRATION_API_TOKEN, 'INTEGRATION_API_TOKEN');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const merchant = params.get('merchant');
  const format = params.get('format') ?? 'json';
  const limit = Math.min(Math.max(Number(params.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = params.get('cursor');
  const classificationFilter = params.get('classification')
    ? new Set(
        params
          .get('classification')!
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      )
    : null;

  const where: Record<string, unknown> = {};
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
  }
  if (merchant) {
    where.merchantName = { contains: merchant, mode: 'insensitive' };
  }

  const rows: TransactionRow[] = [];
  let nextCursor: string | null = cursor;

  // Effective classification depends on the category fallback, so filtering
  // happens after the fetch; keep paging until the requested page is full.
  while (rows.length < limit) {
    const batch = await db.transaction.findMany({
      where,
      select: {
        id: true,
        date: true,
        amount: true,
        type: true,
        status: true,
        description: true,
        merchantName: true,
        classification: true,
        categoryId: true,
        externalId: true,
        accountId: true,
        account: { select: { name: true } },
        category: { select: { name: true, defaultClassification: true } },
        splits: {
          select: {
            amount: true,
            classification: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: limit,
      ...(nextCursor ? { cursor: { id: nextCursor }, skip: 1 } : {}),
    });

    if (batch.length === 0) {
      nextCursor = null;
      break;
    }
    nextCursor = batch[batch.length - 1].id;

    for (const tx of batch) {
      const effective = getEffectiveClassification(tx);
      if (classificationFilter && !classificationFilter.has(effective)) continue;
      rows.push({
        id: tx.id,
        date: tx.date.toISOString(),
        amount: Number(tx.amount),
        type: tx.type,
        status: tx.status,
        description: tx.description,
        merchantName: tx.merchantName,
        classification: tx.classification,
        effectiveClassification: effective,
        categoryId: tx.categoryId,
        categoryName: tx.category?.name ?? null,
        accountId: tx.accountId,
        accountName: tx.account?.name ?? null,
        externalId: tx.externalId,
        splits: tx.splits.map((s) => ({
          amount: Number(s.amount),
          classification: s.classification,
          categoryName: s.category?.name ?? null,
        })),
      });
      if (rows.length >= limit) break;
    }

    if (batch.length < limit) {
      // Reached the end of the table.
      if (rows.length < limit) nextCursor = null;
      break;
    }
  }

  if (format === 'csv') {
    return new NextResponse(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="transactions.csv"',
        ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}),
      },
    });
  }

  return NextResponse.json({
    transactions: rows,
    nextCursor,
  });
}
