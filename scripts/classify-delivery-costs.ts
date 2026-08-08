/**
 * Route delivery costs that the trips reconciliation cannot reach into the
 * Delivery category as business expense.
 *
 * Two sources:
 *
 *  1. Uber tips. Uber bills a courier run and its tip as two separate charges,
 *     and the trips export carries no post-hoc tip figure — so a tip can never
 *     match a trip by amount and is invisible to reconcile-uber-trips. Tips are
 *     identified structurally: an Uber charge the export could not explain,
 *     carrying the bare "Uber" descriptor, for a round half-dollar amount at or
 *     under --tip-max. Larger round amounts (20.00, 27.00) are far more likely
 *     to be fares or Uber Cash top-ups than gratuities, so the ceiling exists to
 *     keep those out; raise it deliberately if that is wrong.
 *
 *  2. Accell Courier Service — a courier vendor, business by nature.
 *
 * Charges already carrying a reconciliation note are left alone: the export
 * proved what those were, and this heuristic must not overwrite evidence.
 *
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   npm run delivery:classify
 *   npm run delivery:classify:apply
 *   npm run delivery:classify -- --tip-max=20
 */
import './load-env';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

const RECONCILED_NOTE = 'matched from Uber data export';

/** Round to the nearest half dollar — the shape a gratuity takes. */
function isRoundHalfDollar(amount: number): boolean {
  return Math.abs(amount * 2 - Math.round(amount * 2)) < 0.001;
}

async function main() {
  const tipMax = Number(argValue('tip-max') ?? 10);

  const anyCategory = await db.category.findFirst({ select: { userId: true } });
  if (!anyCategory) throw new Error('No categories exist; cannot resolve the owning user');

  let delivery = await db.category.findFirst({
    where: { name: 'Delivery', userId: anyCategory.userId },
    select: { id: true },
  });
  if (!delivery && APPLY) {
    delivery = await db.category.create({
      data: {
        userId: anyCategory.userId,
        name: 'Delivery',
        icon: '🛵',
        defaultClassification: 'OPERATING',
      },
      select: { id: true },
    });
    console.log('Created category "Delivery" (OPERATING).');
  }

  const uber = await db.transaction.findMany({
    where: {
      type: 'EXPENSE',
      OR: [
        { merchantName: { contains: 'uber', mode: 'insensitive' } },
        { description: { contains: 'uber', mode: 'insensitive' } },
        { description: { contains: 'ubr', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, date: true, description: true, amount: true, notes: true,
      classification: true, categoryId: true,
      account: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const tips = uber.filter((t) => {
    if (t.notes?.includes(RECONCILED_NOTE)) return false; // export already spoke
    if (t.description.trim() !== 'Uber') return false; // fares carry a fuller descriptor
    const amount = Number(t.amount);
    return isRoundHalfDollar(amount) && amount <= tipMax;
  });

  const accell = await db.transaction.findMany({
    where: {
      OR: [
        { merchantName: { contains: 'accell', mode: 'insensitive' } },
        { description: { contains: 'accell', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, date: true, description: true, amount: true,
      classification: true, categoryId: true,
      account: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const needsWork = (t: { classification: string | null; categoryId: string | null }) =>
    t.classification !== 'OPERATING' || (!!delivery && t.categoryId !== delivery.id);

  const tipChanges = tips.filter(needsWork);
  const accellChanges = accell.filter(needsWork);

  // ── report ─────────────────────────────────────────────────────────────
  const sum = (rows: { amount: unknown }[]) =>
    rows.reduce((s, r) => s + Number(r.amount), 0);

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'}   (tip ceiling $${tipMax.toFixed(2)})\n`);
  console.log(`Uber tips:   ${tips.length} charges, $${sum(tips).toFixed(2)}  (${tipChanges.length} need updating)`);
  console.log(`Accell:      ${accell.length} charges, $${sum(accell).toFixed(2)}  (${accellChanges.length} need updating)`);
  console.log(`\n→ Delivery / OPERATING: ${tipChanges.length + accellChanges.length} rows, ` +
    `$${(sum(tipChanges) + sum(accellChanges)).toFixed(2)}\n`);

  const byAmount = new Map<string, number>();
  for (const t of tips) {
    const k = Number(t.amount).toFixed(2);
    byAmount.set(k, (byAmount.get(k) ?? 0) + 1);
  }
  console.log('Tip amounts captured:');
  for (const [amt, n] of Array.from(byAmount).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  $${amt.padStart(6)} × ${n}`);
  }

  for (const a of accellChanges) {
    console.log(
      `\nAccell: ${a.date.toISOString().slice(0, 10)}  $${Number(a.amount).toFixed(2)}  ` +
      `${a.account.name}  ${a.classification ?? '(none)'} → OPERATING / Delivery`
    );
  }

  // Round Uber charges above the ceiling — deliberately excluded, shown so the
  // decision is visible rather than silent.
  const excluded = uber.filter((t) => {
    if (t.notes?.includes(RECONCILED_NOTE)) return false;
    if (t.description.trim() !== 'Uber') return false;
    const amount = Number(t.amount);
    return isRoundHalfDollar(amount) && amount > tipMax;
  });
  if (excluded.length) {
    const exAmounts = new Map<string, number>();
    for (const t of excluded) {
      const k = Number(t.amount).toFixed(2);
      exAmounts.set(k, (exAmounts.get(k) ?? 0) + 1);
    }
    console.log(
      `\nExcluded as too large to be tips (${excluded.length} rows, $${sum(excluded).toFixed(2)}): ` +
      Array.from(exAmounts).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([a, n]) => `$${a}×${n}`).join(', ')
    );
    console.log(`  Re-run with --tip-max=<higher> to include them.`);
  }

  if (!APPLY) {
    console.log('\nNo changes written. Re-run with --apply to commit.\n');
    return;
  }
  if (!delivery) throw new Error('Delivery category missing');

  const deliveryId = delivery.id;
  await db.$transaction(async (tx) => {
    for (const t of tipChanges) {
      await tx.transaction.update({
        where: { id: t.id },
        data: {
          classification: 'OPERATING',
          categoryId: deliveryId,
          isReviewed: true,
          notes: 'Uber delivery tip — classified business by rule (round amount, unmatched by trips export)',
        },
      });
    }
    for (const a of accellChanges) {
      await tx.transaction.update({
        where: { id: a.id },
        data: {
          classification: 'OPERATING',
          categoryId: deliveryId,
          isReviewed: true,
          notes: 'Accell Courier Service — delivery vendor',
        },
      });
    }
  });

  console.log(`\nApplied ${tipChanges.length + accellChanges.length} update(s).\n`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
