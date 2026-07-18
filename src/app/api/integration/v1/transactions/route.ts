import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';
import {
  getEffectiveClassification,
  directionFor,
  type EffectiveClassification,
  type Direction,
} from '@/lib/pnl';
import {
  costBucketFor,
  dollarsToCents,
  effectiveCashflowClassification,
  type CostBucket,
} from '@/lib/cashflow';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;

type TransactionRow = {
  id: string;
  date: string;
  updatedAt: string;
  amount: number;
  amountCents: number;
  type: string;
  status: string;
  description: string;
  merchantName: string | null;
  classification: string | null;
  effectiveClassification: EffectiveClassification;
  direction: Direction;
  costBucket: CostBucket;
  costSubcategory: string | null;
  categoryId: string | null;
  categoryName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  accountId: string;
  accountName: string | null;
  externalId: string | null;
  category: { id: string; name: string } | null;
  vendor: { id: string | null; name: string } | null;
  squareCustomerId: string | null;
  splits: {
    id: string;
    amount: number;
    amountCents: number;
    classification: string | null;
    effectiveClassification: string | null;
    costBucket: CostBucket;
    costSubcategory: string | null;
    category: { id: string; name: string } | null;
    categoryName: string | null;
  }[];
};

type ChangeCursor = { updatedAt: string; id: string };

function encodeCursor(cursor: ChangeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string | null): ChangeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ChangeCursor;
    if (!parsed.id || Number.isNaN(new Date(parsed.updatedAt).getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getSquareCustomerId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).customer_id;
  return typeof value === 'string' && value ? value : null;
}

function toCsv(rows: TransactionRow[]): string {
  const headers = [
    'id',
    'date',
    'updatedAt',
    'amount',
    'amountCents',
    'type',
    'status',
    'description',
    'merchantName',
    'classification',
    'effectiveClassification',
    'direction',
    'categoryName',
    'vendorId',
    'vendorName',
    'customerName',
    'customerEmail',
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
 *   from, to          — ISO dates (inclusive, on transaction date)
 *   updatedSince      — ISO timestamp; only rows changed at/after this. Use for
 *                       cheap incremental sync that also re-reads corrected rows
 *                       (reclassification, merchant fixes bump updatedAt).
 *   classification    — comma-separated effective classifications
 *                       (e.g. COGS,OPERATING); applied after category fallback
 *   direction         — outflow | inflow | transfer (comma-separated). Derived
 *                       from the effective classification. The brain's
 *                       payment.completed feed uses direction=outflow (vendor
 *                       payments) — see docs/integration-local-effort.md.
 *   merchant          — case-insensitive substring match on merchantName
 *   format            — json (default) | csv
 *   limit             — page size, default 500, max 2000
 *   cursor            — opaque (updatedAt,id) cursor; legacy id-only cursors
 *                       remain accepted for backward compatibility
 */
export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.INTEGRATION_API_TOKEN, 'INTEGRATION_API_TOKEN');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const updatedSince = params.get('updatedSince');
  const merchant = params.get('merchant');
  const format = params.get('format') ?? 'json';
  const limit = Math.min(Math.max(Number(params.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursorParam = params.get('cursor');
  const classificationFilter = params.get('classification')
    ? new Set(
        params
          .get('classification')!
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      )
    : null;
  const directionFilter = params.get('direction')
    ? new Set(
        params
          .get('direction')!
          .split(',')
          .map((d) => d.trim().toLowerCase())
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
  if (updatedSince) {
    const since = new Date(updatedSince);
    if (!Number.isNaN(since.getTime())) {
      where.updatedAt = { gte: since };
    }
  }
  if (merchant) {
    where.merchantName = { contains: merchant, mode: 'insensitive' };
  }

  const rows: TransactionRow[] = [];
  let cursor = decodeCursor(cursorParam);
  // Keep accepting the original id-only cursor during the v1 transition.
  if (cursorParam && !cursor) {
    const legacy = await db.transaction.findUnique({
      where: { id: cursorParam },
      select: { id: true, updatedAt: true },
    });
    if (legacy) cursor = { id: legacy.id, updatedAt: legacy.updatedAt.toISOString() };
  }
  let nextCursor: ChangeCursor | null = cursor;

  // Effective classification depends on the category fallback, so filtering
  // happens after the fetch; keep paging until the requested page is full.
  while (rows.length < limit) {
    const batch = await db.transaction.findMany({
      where: nextCursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { updatedAt: { gt: new Date(nextCursor.updatedAt) } },
                  { updatedAt: new Date(nextCursor.updatedAt), id: { gt: nextCursor.id } },
                ],
              },
            ],
          }
        : where,
      select: {
        id: true,
        date: true,
        updatedAt: true,
        amount: true,
        type: true,
        status: true,
        description: true,
        merchantName: true,
        classification: true,
        categoryId: true,
        externalId: true,
        metadata: true,
        accountId: true,
        vendorId: true,
        account: { select: { name: true } },
        category: { select: { id: true, name: true, defaultClassification: true } },
        vendor: { select: { name: true } },
        squareCustomer: {
          select: { squareCustomerId: true, name: true, companyName: true, email: true },
        },
        splits: {
          select: {
            id: true,
            amount: true,
            classification: true,
            category: { select: { id: true, name: true, defaultClassification: true } },
          },
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    if (batch.length === 0) {
      nextCursor = null;
      break;
    }
    nextCursor = {
      updatedAt: batch[batch.length - 1].updatedAt.toISOString(),
      id: batch[batch.length - 1].id,
    };

    for (const tx of batch) {
      const effective = getEffectiveClassification(tx);
      if (classificationFilter && !classificationFilter.has(effective)) continue;
      const direction = directionFor(effective);
      if (directionFilter && !directionFilter.has(direction)) continue;
      const rawEffective = effectiveCashflowClassification(tx);
      const bucket = costBucketFor({
        classification: rawEffective,
        categoryName: tx.category?.name,
        merchantName: tx.merchantName,
        description: tx.description,
        type: tx.type,
      });
      rows.push({
        id: tx.id,
        date: tx.date.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
        amount: Number(tx.amount),
        amountCents: dollarsToCents(tx.amount),
        type: tx.type,
        status: tx.status,
        description: tx.description,
        merchantName: tx.merchantName,
        classification: tx.classification,
        effectiveClassification: effective,
        direction,
        ...bucket,
        categoryId: tx.categoryId,
        categoryName: tx.category?.name ?? null,
        vendorId: tx.vendorId,
        vendorName: tx.vendor?.name ?? null,
        customerName:
          tx.squareCustomer?.name ?? tx.squareCustomer?.companyName ?? null,
        customerEmail: tx.squareCustomer?.email ?? null,
        accountId: tx.accountId,
        accountName: tx.account?.name ?? null,
        externalId: tx.externalId,
        category: tx.category ? { id: tx.category.id, name: tx.category.name } : null,
        vendor: tx.vendor?.name
          ? { id: tx.vendorId, name: tx.vendor.name }
          : tx.merchantName
            ? { id: null, name: tx.merchantName }
            : null,
        squareCustomerId:
          tx.squareCustomer?.squareCustomerId ?? getSquareCustomerId(tx.metadata),
        splits: tx.splits.map((s) => {
          const splitEffective = effectiveCashflowClassification(s, tx);
          const splitBucket = costBucketFor({
            classification: splitEffective,
            categoryName: s.category?.name ?? tx.category?.name,
            merchantName: tx.merchantName,
            description: tx.description,
            type: tx.type,
          });
          return {
            id: s.id,
            amount: Number(s.amount),
            amountCents: dollarsToCents(s.amount),
            classification: s.classification,
            effectiveClassification: splitEffective,
            ...splitBucket,
            category: s.category ? { id: s.category.id, name: s.category.name } : null,
            categoryName: s.category?.name ?? null,
          };
        }),
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
        ...(nextCursor ? { 'X-Next-Cursor': encodeCursor(nextCursor) } : {}),
      },
    });
  }

  return NextResponse.json({
    transactions: rows,
    nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
  });
}
