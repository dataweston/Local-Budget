import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeServiceRequest } from '@/lib/service-auth';
import { getEffectiveClassification } from '@/lib/pnl';
import { normalizeVendorName } from '@/lib/normalization/vendors';

export const dynamic = 'force-dynamic';

type VendorRollup = {
  vendorId: string | null;
  name: string;
  normalizedName: string;
  rawNames: string[];
  aliases: string[];
  txCount: number;
  totalSpend: number;
  avgAmount: number;
  firstSeen: string;
  lastSeen: string;
  primaryClassification: string;
};

/**
 * GET /api/integration/v1/vendors
 *
 * Vendor spend rollups aggregated from transactions, shaped for the
 * local-effort-app brain (replaces seed-brain.js's direct DB read).
 * Bearer-token authenticated via INTEGRATION_API_TOKEN.
 *
 * Query params:
 *   classification — comma-separated effective classifications to include;
 *                    defaults to COGS,OPERATING (business spend)
 *   from, to       — ISO date window
 */
export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.INTEGRATION_API_TOKEN, 'INTEGRATION_API_TOKEN');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const classifications = new Set(
    (params.get('classification') ?? 'COGS,OPERATING')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
  );

  const transactions = await db.transaction.findMany({
    where: {
      merchantName: { not: null },
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    },
    select: {
      amount: true,
      date: true,
      type: true,
      merchantName: true,
      classification: true,
      vendorId: true,
      vendor: { select: { id: true, name: true, aliases: true } },
      category: { select: { defaultClassification: true } },
    },
    orderBy: { date: 'asc' },
  });

  const rollups = new Map<
    string,
    VendorRollup & { rawNameCounts: Map<string, number>; classificationCounts: Map<string, number> }
  >();

  for (const tx of transactions) {
    const effective = getEffectiveClassification(tx);
    if (!classifications.has(effective)) continue;

    const raw = tx.merchantName as string;
    // Prefer the stable materialized vendor (resolves bank-truncation splits);
    // fall back to on-the-fly normalization for rows not yet linked.
    const canonicalName = tx.vendor?.name ?? normalizeVendorName(raw);
    if (!canonicalName) continue;
    const groupKey = tx.vendorId ?? `name:${canonicalName.toLowerCase()}`;

    let rollup = rollups.get(groupKey);
    if (!rollup) {
      rollup = {
        vendorId: tx.vendorId ?? null,
        name: canonicalName,
        normalizedName: canonicalName.toLowerCase(),
        rawNames: [],
        aliases: tx.vendor?.aliases ?? [],
        txCount: 0,
        totalSpend: 0,
        avgAmount: 0,
        firstSeen: tx.date.toISOString(),
        lastSeen: tx.date.toISOString(),
        primaryClassification: effective,
        rawNameCounts: new Map(),
        classificationCounts: new Map(),
      };
      rollups.set(groupKey, rollup);
    }

    rollup.txCount += 1;
    rollup.totalSpend += Math.abs(Number(tx.amount));
    rollup.rawNameCounts.set(raw, (rollup.rawNameCounts.get(raw) ?? 0) + 1);
    rollup.classificationCounts.set(effective, (rollup.classificationCounts.get(effective) ?? 0) + 1);
    if (tx.date.toISOString() < rollup.firstSeen) rollup.firstSeen = tx.date.toISOString();
    if (tx.date.toISOString() > rollup.lastSeen) rollup.lastSeen = tx.date.toISOString();
  }

  const vendors: VendorRollup[] = Array.from(rollups.values())
    .map((rollup) => {
      const { rawNameCounts, classificationCounts, ...rest } = rollup;
      const canonical =
        Array.from(rawNameCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? rest.name;
      // COGS wins ties: it is the classification the margin tooling cares about.
      const primary = classificationCounts.has('COGS')
        ? 'COGS'
        : Array.from(classificationCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'OPERATING';
      const rawNames = Array.from(rawNameCounts.keys());
      const mergedAliases = Array.from(new Set([...(rest.aliases ?? []), ...rawNames]));
      return {
        ...rest,
        name: canonical,
        rawNames,
        aliases: mergedAliases,
        avgAmount: rest.txCount > 0 ? Number((rest.totalSpend / rest.txCount).toFixed(2)) : 0,
        totalSpend: Number(rest.totalSpend.toFixed(2)),
        primaryClassification: primary,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);

  return NextResponse.json({ vendors, count: vendors.length });
}
