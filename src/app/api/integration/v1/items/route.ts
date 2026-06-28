import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 1000;

/**
 * GET /api/integration/v1/items
 *
 * Line-item export for the brain's recipe/margin subsystem. Each row is one
 * LineItem with its parent transaction's date, merchant/customer, and amount —
 * the per-ingredient (or per-sold-item) price + unit signal the brain needs for
 * food-cost / contribution-margin analysis. Bearer-token authenticated.
 *
 * Query params:
 *   from, to       — ISO dates (inclusive, on the parent transaction's date)
 *   updatedSince   — ISO timestamp; only lines whose transaction changed since
 *   lineType       — comma-separated LineItemType filter (default: ITEM)
 *   source         — "square" (order items) | "receipt" | all (default all)
 *   limit, cursor  — pagination (cursor is the last row id)
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
  const source = params.get('source');
  const limit = Math.min(Math.max(Number(params.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = params.get('cursor');
  const lineTypes = params.get('lineType')
    ? params
        .get('lineType')!
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : ['ITEM'];

  const txDateFilter =
    from || to
      ? {
          date: {
            ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
          },
        }
      : {};
  const txUpdatedFilter =
    updatedSince && !Number.isNaN(new Date(updatedSince).getTime())
      ? { updatedAt: { gte: new Date(updatedSince) } }
      : {};

  const where: Record<string, unknown> = {
    lineType: { in: lineTypes as any },
    transactionId: { not: null },
    transaction: { ...txDateFilter, ...txUpdatedFilter },
  };
  if (source === 'square') {
    where.sourceUid = { not: null };
  } else if (source === 'receipt') {
    where.receiptId = { not: null };
  }

  const lines = await db.lineItem.findMany({
    where,
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      lineType: true,
      classification: true,
      sourceUid: true,
      vendorId: true,
      itemId: true,
      item: { select: { name: true, unitOfMeasure: true } },
      vendor: { select: { name: true } },
      transaction: {
        select: {
          id: true,
          date: true,
          merchantName: true,
          squareCustomer: { select: { name: true, companyName: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const rows = lines.map((li) => ({
    id: li.id,
    transactionId: li.transaction?.id ?? null,
    date: li.transaction?.date.toISOString() ?? null,
    merchantName: li.transaction?.merchantName ?? null,
    customerName:
      li.transaction?.squareCustomer?.name ??
      li.transaction?.squareCustomer?.companyName ??
      null,
    description: li.description,
    itemName: li.item?.name ?? null,
    unitOfMeasure: li.item?.unitOfMeasure ?? null,
    vendorName: li.vendor?.name ?? null,
    vendorId: li.vendorId,
    itemId: li.itemId,
    quantity: li.quantity != null ? Number(li.quantity) : null,
    unitPrice: li.unitPrice != null ? Number(li.unitPrice) : null,
    totalPrice: Number(li.totalPrice),
    lineType: li.lineType,
    classification: li.classification,
    sourceUid: li.sourceUid,
  }));

  const nextCursor = lines.length === limit ? lines[lines.length - 1].id : null;

  return NextResponse.json({ items: rows, nextCursor });
}
