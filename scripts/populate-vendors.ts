/**
 * Populate the `vendors` table from existing transaction merchant names and
 * link each transaction to its canonical Vendor (transactions.vendorId).
 *
 * The brain ranks this as the single biggest data-quality win: it lets the
 * brain resolve vendors by a stable id instead of fuzzy-matching merchantName,
 * eliminating duplicate-vendor guessing at the source.
 *
 * Also computes each vendor's dominant defaultClassification (COGS/OPERATING/…)
 * from its linked transactions, so the null-classification pass can lean on it.
 *
 * Dry-run by default; pass --apply to write. Usage:
 *   npm run vendors:populate           # dry run
 *   npm run vendors:populate:apply     # writes
 */
import { PrismaClient } from '@prisma/client';
import {
  resolveVendorId,
  createVendorResolverCache,
} from '../src/lib/normalization/vendor-resolver';
import { getEffectiveClassification } from '../src/lib/pnl';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Vendor population (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const transactions = await db.transaction.findMany({
    where: { merchantName: { not: null } },
    select: {
      id: true,
      merchantName: true,
      vendorId: true,
      type: true,
      classification: true,
      category: { select: { defaultClassification: true } },
    },
    orderBy: { date: 'asc' },
  });

  console.log(`${transactions.length} transactions with a merchant name`);

  const cache = createVendorResolverCache();
  // vendorId -> classification -> count, to pick a dominant classification.
  const classVotes = new Map<string, Map<string, number>>();
  let linked = 0;
  let alreadyLinked = 0;
  let processed = 0;

  for (const tx of transactions) {
    if (!APPLY) {
      continue;
    }

    processed++;
    if (processed % 500 === 0) {
      console.log(`  ${processed}/${transactions.length} processed (${linked} relinked)`);
    }

    const vendorId = await resolveVendorId(db, tx.merchantName, cache);
    if (!vendorId) continue;

    if (tx.vendorId === vendorId) {
      alreadyLinked++;
    } else {
      await db.transaction.update({ where: { id: tx.id }, data: { vendorId } });
      linked++;
    }

    const effective = getEffectiveClassification(tx);
    if (effective && effective !== 'TRANSFER') {
      let votes = classVotes.get(vendorId);
      if (!votes) {
        votes = new Map();
        classVotes.set(vendorId, votes);
      }
      votes.set(effective, (votes.get(effective) ?? 0) + 1);
    }
  }

  if (!APPLY) {
    const distinct = new Set(transactions.map((t) => t.merchantName!.toLowerCase()));
    console.log(`Would materialize ~${distinct.size} raw names into canonical vendors.`);
    console.log('Re-run with --apply to write.');
    return;
  }

  // Write each vendor's dominant classification.
  let classified = 0;
  for (const [vendorId, votes] of Array.from(classVotes.entries())) {
    const dominant = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!dominant) continue;
    await db.vendor.update({
      where: { id: vendorId },
      data: { defaultClassification: dominant as any },
    });
    classified++;
  }

  // Relinking under improved normalization strands the old junk vendors
  // ("Debit Card Costco Whse #0652") with no references — drop them so
  // /v1/vendors only serves canonical rows.
  const orphans = await db.vendor.deleteMany({
    where: { transactions: { none: {} }, lineItems: { none: {} } },
  });

  const vendorCount = await db.vendor.count();
  console.log(
    `Linked ${linked} transactions (${alreadyLinked} already linked); ` +
      `deleted ${orphans.count} orphaned vendors; ` +
      `vendors table now has ${vendorCount} rows; ` +
      `set defaultClassification on ${classified} vendors.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
