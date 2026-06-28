import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';

export const dynamic = 'force-dynamic';

type PricePoint = { date: string; unitPrice: number; unitOfMeasure: string | null };

type ItemDrift = {
  itemId: string | null;
  itemName: string;
  unitOfMeasure: string | null;
  observations: number;
  firstUnitPrice: number;
  lastUnitPrice: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  pctChange: number; // first -> last, percent
  points: PricePoint[];
};

/**
 * GET /api/integration/v1/price-drift
 *
 * Per-item unit-price trend from line items that carry a unitPrice, so the
 * brain can drive price-drift / inflation inferences and recipe re-costing.
 * Bearer-token authenticated.
 *
 * Query params:
 *   from, to   — ISO date window (on parent transaction or receipt date)
 *   minPoints  — minimum observations to include an item (default 2)
 *   item       — case-insensitive substring on item name
 */
export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.INTEGRATION_API_TOKEN, 'INTEGRATION_API_TOKEN');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const itemFilter = params.get('item')?.toLowerCase();
  const minPoints = Math.max(Number(params.get('minPoints')) || 2, 1);

  const lines = await db.lineItem.findMany({
    where: {
      unitPrice: { not: null },
      lineType: 'ITEM',
      ...(itemFilter
        ? {
            OR: [
              { description: { contains: itemFilter, mode: 'insensitive' } },
              { item: { is: { name: { contains: itemFilter, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    select: {
      unitPrice: true,
      description: true,
      itemId: true,
      item: { select: { name: true, unitOfMeasure: true } },
      transaction: { select: { date: true } },
      receipt: { select: { receiptDate: true, createdAt: true } },
    },
  });

  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;

  // Group by catalog item when known, else by normalized description.
  const groups = new Map<string, ItemDrift & { _points: { date: Date; unitPrice: number; unit: string | null }[] }>();

  for (const li of lines) {
    const date =
      li.transaction?.date ?? li.receipt?.receiptDate ?? li.receipt?.createdAt ?? null;
    if (!date) continue;
    if (fromDate && date < fromDate) continue;
    if (toDate && date > toDate) continue;

    const name = li.item?.name ?? li.description;
    const key = li.itemId ?? `desc:${name.toLowerCase()}`;
    const unitPrice = Number(li.unitPrice);

    let g = groups.get(key);
    if (!g) {
      g = {
        itemId: li.itemId,
        itemName: name,
        unitOfMeasure: li.item?.unitOfMeasure ?? null,
        observations: 0,
        firstUnitPrice: 0,
        lastUnitPrice: 0,
        minUnitPrice: Infinity,
        maxUnitPrice: -Infinity,
        pctChange: 0,
        points: [],
        _points: [],
      };
      groups.set(key, g);
    }
    g._points.push({ date, unitPrice, unit: li.item?.unitOfMeasure ?? null });
  }

  const items: ItemDrift[] = [];
  for (const g of Array.from(groups.values())) {
    if (g._points.length < minPoints) continue;
    g._points.sort((a, b) => a.date.getTime() - b.date.getTime());
    const prices = g._points.map((p) => p.unitPrice);
    g.observations = g._points.length;
    g.firstUnitPrice = prices[0];
    g.lastUnitPrice = prices[prices.length - 1];
    g.minUnitPrice = Math.min(...prices);
    g.maxUnitPrice = Math.max(...prices);
    g.pctChange =
      g.firstUnitPrice > 0
        ? Number((((g.lastUnitPrice - g.firstUnitPrice) / g.firstUnitPrice) * 100).toFixed(2))
        : 0;
    g.points = g._points.map((p) => ({
      date: p.date.toISOString(),
      unitPrice: p.unitPrice,
      unitOfMeasure: p.unit,
    }));
    const { _points, ...rest } = g;
    items.push(rest);
  }

  // Biggest movers first.
  items.sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));

  return NextResponse.json({ items, count: items.length });
}
