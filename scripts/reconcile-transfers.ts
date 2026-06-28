/**
 * Reconcile internal transfers across the owner's accounts: pair debits with
 * matching credits between INTERNAL accounts, mark both legs TRANSFER, link
 * them, and surface exceptions (owner draws/contributions; unmatched inbound
 * money = candidate true income / investor funds).
 *
 * Dry-run by default; pass --apply to write.
 *   npm run transfers:reconcile          # dry run
 *   npm run transfers:reconcile:apply    # writes
 *
 * Optional: --since=YYYY-MM-DD  --gap=<days>
 */
import { PrismaClient } from '@prisma/client';
import { reconcileInternalTransfers } from '../src/lib/transfers/service';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1];
const gapArg = process.argv.find((a) => a.startsWith('--gap='))?.split('=')[1];

async function main() {
  console.log(`Transfer reconciliation (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const users = await db.user.findMany({ select: { id: true, email: true } });

  for (const user of users) {
    const summary = await reconcileInternalTransfers(db, user.id, {
      apply: APPLY,
      since: sinceArg ? new Date(sinceArg) : undefined,
      maxDayGap: gapArg ? Number(gapArg) : undefined,
    });
    if (summary.candidatesConsidered === 0) continue;

    console.log(`\n${user.email}:`);
    console.log(`  candidates: ${summary.candidatesConsidered}`);
    console.log(`  pairs matched: ${summary.pairsMatched} (legs reclassified: ${summary.legsReclassified})`);
    console.log(`  owner draws (business->personal): ${summary.ownerDraws.length}`);
    console.log(`  owner contributions (personal->business): ${summary.ownerContributions.length}`);
    console.log(`  unmatched inbound (candidate income/investor): ${summary.unmatchedInflows.length}`);
    for (const u of summary.unmatchedInflows.slice(0, 10)) {
      console.log(`    + $${u.amount.toFixed(2)} on ${u.date.slice(0, 10)} (acct ${u.accountId})`);
    }
  }

  if (!APPLY) console.log('\nRe-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
