/**
 * Classify the null-classification bucket (brain P0 #1: 1,303 rows invisible to
 * the brain). Applies, in priority order:
 *   1. the transaction's category defaultClassification
 *   2. the resolved vendor's learned defaultClassification
 *   3. type fallback (INCOME -> INCOME, TRANSFER -> TRANSFER)
 *
 * Also flags likely PERSONAL transfers-to-people (Zelle/Venmo to a named person,
 * e.g. the "Zelle to Alan" case the brain found mis-coded OPERATING) so they are
 * NOT left as business spend. These are set to PERSONAL.
 *
 * Dry-run by default; pass --apply to write.
 *   npm run classify:nulls           # dry run
 *   npm run classify:nulls:apply     # writes
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// "Zelle/Venmo/payment to <FirstName>" — a transfer to an individual, almost
// always personal, never business COGS/OPERATING.
const PERSON_PAYMENT =
  /(zelle|venmo|cash app|paypal).{0,30}\b(to|payment to|sent to)\b\s+[a-z]/i;

async function main() {
  console.log(`Null-classification pass (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const rows = await db.transaction.findMany({
    where: { classification: null },
    select: {
      id: true,
      type: true,
      description: true,
      merchantName: true,
      category: { select: { defaultClassification: true } },
      vendor: { select: { defaultClassification: true } },
    },
  });

  console.log(`${rows.length} transactions with null classification`);

  const counts: Record<string, number> = {};
  let personalFlagged = 0;
  let updated = 0;

  for (const r of rows) {
    let resolved: string | null = null;

    const text = `${r.merchantName ?? ''} ${r.description ?? ''}`;
    if (PERSON_PAYMENT.test(text)) {
      resolved = 'PERSONAL';
      personalFlagged++;
    } else if (r.category?.defaultClassification) {
      resolved = r.category.defaultClassification;
    } else if (r.vendor?.defaultClassification) {
      resolved = r.vendor.defaultClassification;
    } else if (r.type === 'INCOME') {
      resolved = 'INCOME';
    } else if (r.type === 'TRANSFER') {
      resolved = 'TRANSFER';
    }

    if (!resolved) continue;
    counts[resolved] = (counts[resolved] ?? 0) + 1;

    if (APPLY) {
      await db.transaction.update({
        where: { id: r.id },
        data: { classification: resolved as any },
      });
      updated++;
    }
  }

  console.log('Resolved by classification:', counts);
  console.log(`Flagged ${personalFlagged} person-payments as PERSONAL.`);
  console.log(
    APPLY
      ? `Updated ${updated} transactions. ${rows.length - Object.values(counts).reduce((a, b) => a + b, 0)} still unresolved (need manual review).`
      : 'Re-run with --apply to write.'
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
