/**
 * Reconcile bank "Uber" charges against an Uber "Download Your Data" export and
 * classify them by what the trip actually was.
 *
 * The bank descriptor for every Uber charge is just "Uber" — rides, courier runs
 * and Eats orders are indistinguishable, and Plaid labels all of them
 * TRANSPORTATION_TAXIS_AND_RIDE_SHARES. The trips export is the only source that
 * says which product was bought:
 *
 *   global_product_name = RiderItemDelivery  → Courier / Connect  → BUSINESS
 *   global_product_name = UberX              → a ride            → PERSONAL
 *
 * Matching is on exact fare against the bank amount, within a lag window (Uber
 * bills on a delay, observed 0-15 days). Only unambiguous 1:1 matches are
 * applied; anything the export cannot vouch for is left alone and reported, so
 * an incomplete export can never silently reclassify a charge.
 *
 * Usage:
 *   npm run uber:reconcile -- --file="<path to trips_data-0.csv>"
 *   npm run uber:reconcile:apply -- --file="<path>"
 *   ...optional: --lag=20  (max days between trip and bank posting)
 */
import './load-env';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

/** RFC4180-ish parser: the export quotes addresses containing commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((x) => x.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    if (ch !== '\r') field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim().length > 0)) rows.push(row);
  return rows;
}

type Trip = {
  date: Date;
  dateStr: string;
  kind: 'COURIER' | 'RIDER';
  product: string;
  status: string;
  fare: number;
  /** Upfront quote. Uber bills this instead of the metered fare on many trips,
   *  so both are valid match keys against the bank amount. */
  upfront: number;
  matchedTxId?: string;
};

const DAY = 86_400_000;

async function main() {
  const file = argValue('file');
  if (!file) throw new Error('--file="<path to trips_data-0.csv>" is required');
  const lagDays = Number(argValue('lag') ?? 20);

  const rows = parseCsv(readFileSync(file, 'utf8'));
  const header = rows[0].map((h) => h.trim().replace(/^﻿/, ''));
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found in export`);
    return i;
  };
  const iProduct = col('global_product_name');
  const iProductName = col('product_type_name');
  const iStatus = col('status');
  const iFare = col('fare_amount');
  const iUpfront = col('client_upfront_fare_usd');
  const iRequest = col('request_timestamp_local');

  const trips: Trip[] = rows.slice(1).map((r) => {
    const dateStr = r[iRequest].slice(0, 10);
    return {
      date: new Date(`${dateStr}T00:00:00.000Z`),
      dateStr,
      kind: r[iProduct] === 'RiderItemDelivery' ? 'COURIER' : 'RIDER',
      product: r[iProductName],
      status: r[iStatus],
      fare: Number(r[iFare] || 0),
      upfront: Number(r[iUpfront] || 0),
    };
  });

  const billable = trips.filter((t) => t.fare > 0 || t.upfront > 0);

  // Bank-side Uber charges. Lyft is excluded: it is a separate service and this
  // export says nothing about it.
  const txns = await db.transaction.findMany({
    where: {
      type: 'EXPENSE',
      OR: [
        { merchantName: { contains: 'uber', mode: 'insensitive' } },
        { description: { contains: 'uber', mode: 'insensitive' } },
        { description: { contains: 'ubr', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, date: true, description: true, amount: true,
      classification: true, categoryId: true,
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  });

  // Greedy 1:1 assignment, closest posting date first. A bank charge may only
  // claim one trip and vice versa, so duplicate fares cannot fan out.
  const usedTx = new Set<string>();
  type Pair = { trip: Trip; tx: (typeof txns)[number]; lag: number; via: 'fare' | 'upfront' };
  const candidates: Pair[] = [];
  for (const trip of billable) {
    for (const tx of txns) {
      const amount = Number(tx.amount);
      const via: 'fare' | 'upfront' | null =
        Math.abs(amount - trip.fare) <= 0.005 && trip.fare > 0
          ? 'fare'
          : Math.abs(amount - trip.upfront) <= 0.005 && trip.upfront > 0
            ? 'upfront'
            : null;
      if (!via) continue;
      const lag = Math.round((tx.date.getTime() - trip.date.getTime()) / DAY);
      if (lag < 0 || lag > lagDays) continue;
      candidates.push({ trip, tx, lag, via });
    }
  }
  // Prefer the metered fare over the upfront quote, then the closest posting.
  candidates.sort((a, b) => (a.via === b.via ? a.lag - b.lag : a.via === 'fare' ? -1 : 1));

  const pairs: Pair[] = [];
  for (const c of candidates) {
    if (c.trip.matchedTxId || usedTx.has(c.tx.id)) continue;
    c.trip.matchedTxId = c.tx.id;
    usedTx.add(c.tx.id);
    pairs.push(c);
  }

  const target = (kind: Trip['kind']) => (kind === 'COURIER' ? 'OPERATING' : 'PERSONAL');

  // Courier runs are customer delivery cost and deserve their own line on the
  // P&L; leaving them under "Transportation" (a personal-default category)
  // reads wrong on a lender-facing statement even though the classification
  // override makes the maths correct.
  const anyCategory = await db.category.findFirst({ select: { userId: true } });
  if (!anyCategory) throw new Error('No categories exist; cannot resolve the owning user');
  let delivery = await db.category.findFirst({
    where: { name: 'Delivery', userId: anyCategory.userId },
    select: { id: true, defaultClassification: true },
  });
  const willCreateDelivery = !delivery;

  const needsCategory = (p: Pair) =>
    p.trip.kind === 'COURIER' && (!delivery || p.tx.categoryId !== delivery.id);
  const changes = pairs.filter(
    (p) => p.tx.classification !== target(p.trip.kind) || needsCategory(p)
  );

  // ── report ─────────────────────────────────────────────────────────────
  const courierTrips = trips.filter((t) => t.kind === 'COURIER').length;
  const riderTrips = trips.filter((t) => t.kind === 'RIDER').length;

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'}  (lag window ${lagDays} days)\n`);
  console.log(`Export:  ${trips.length} trips — ${courierTrips} courier, ${riderTrips} rider`);
  console.log(`         ${billable.length} billable (fare > 0); ${trips.length - billable.length} cancelled/free`);
  console.log(`Bank:    ${txns.length} Uber charges\n`);
  console.log(`Matched: ${pairs.length} of ${billable.length} billable trips\n`);

  const byKind = (k: Trip['kind']) => pairs.filter((p) => p.trip.kind === k);
  for (const kind of ['COURIER', 'RIDER'] as const) {
    const set = byKind(kind);
    const sum = set.reduce((s, p) => s + Number(p.tx.amount), 0);
    console.log(
      `  ${kind} → ${target(kind)}${kind === 'COURIER' ? ' + category Delivery' : ''}: ` +
      `${set.length} charges, $${sum.toFixed(2)}`
    );
  }

  // Match rate per product type: settles whether any one product (e.g. the
  // oddly-named "[TESTING DO NOT USE] Courier") accounts for the shortfall.
  console.log('\nMatch rate by product type:');
  const products = Array.from(new Set(trips.map((t) => t.product))).sort();
  for (const product of products) {
    const all = trips.filter((t) => t.product === product);
    const hit = all.filter((t) => t.matchedTxId).length;
    const cancelled = all.filter((t) => t.fare === 0).length;
    console.log(
      `  ${product.padEnd(32)} ${String(hit).padStart(2)}/${String(all.length).padEnd(2)} matched` +
      `${cancelled ? `  (${cancelled} cancelled, never billed)` : ''}`
    );
  }

  console.log(`\nReclassifications to write: ${changes.length}\n`);
  for (const c of changes) {
    console.log(
      `  ${c.tx.date.toISOString().slice(0, 10)}  $${Number(c.tx.amount).toFixed(2).padStart(7)}  ` +
      `${c.tx.account.name.padEnd(15)} ${(c.tx.classification ?? '(none)').padEnd(13)} → ${target(c.trip.kind)}` +
      `   [${c.trip.kind} ${c.trip.product} ${c.trip.dateStr}, +${c.lag}d, ${c.via}]`
    );
  }

  const unmatchedTrips = billable.filter((t) => !t.matchedTxId);
  if (unmatchedTrips.length) {
    console.log(`\nTrips with no bank match (${unmatchedTrips.length}) — not applied:`);
    for (const t of unmatchedTrips) {
      console.log(
        `  ${t.dateStr}  fare $${t.fare.toFixed(2).padStart(7)} / upfront $${t.upfront.toFixed(2).padStart(7)}  ${t.kind} ${t.product}`
      );
    }
  }

  const unmatchedTx = txns.filter((t) => !usedTx.has(t.id));
  const unmatchedSum = unmatchedTx.reduce((s, t) => s + Number(t.amount), 0);
  console.log(
    `\nBank charges the export cannot explain: ${unmatchedTx.length}, $${unmatchedSum.toFixed(2)} — left untouched.`
  );
  console.log(
    `  These are NOT proven to be courier. The export covers ` +
    `${trips.length} trips over ${billable[0]?.dateStr ?? '?'}..${billable[billable.length - 1]?.dateStr ?? '?'}, ` +
    `far fewer than the ${txns.length} bank charges, so most are unexplained\n` +
    `  rather than reclassifiable — likely Uber Eats orders, which this export omits.`
  );

  if (!APPLY) {
    console.log('\nNo changes written. Re-run with --apply to commit.\n');
    return;
  }

  if (willCreateDelivery) {
    delivery = await db.category.create({
      data: {
        userId: anyCategory.userId,
        name: 'Delivery',
        icon: '🛵',
        defaultClassification: 'OPERATING',
      },
      select: { id: true, defaultClassification: true },
    });
    console.log('\nCreated category "Delivery" (OPERATING).');
  }

  await db.$transaction(async (tx) => {
    for (const c of changes) {
      await tx.transaction.update({
        where: { id: c.tx.id },
        data: {
          classification: target(c.trip.kind) as 'OPERATING' | 'PERSONAL',
          ...(c.trip.kind === 'COURIER' && delivery ? { categoryId: delivery.id } : {}),
          isReviewed: true,
          notes: `Uber ${c.trip.kind.toLowerCase()} (${c.trip.product}) ${c.trip.dateStr} — matched from Uber data export`,
        },
      });
    }
  });

  console.log(`\nApplied ${changes.length} reclassification(s).\n`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
