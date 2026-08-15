/**
 * Link processor payouts to the bank deposits that carry them, including the
 * batched case where several same-day payouts arrive as one deposit.
 *
 * The Square sync runs this automatically for new payouts; this script applies
 * it to settlements already in the database without re-pulling from Square.
 *
 * Dry-run by default; pass --apply to write.
 *   npm run settlements:rematch          # preview
 *   npm run settlements:rematch:apply    # writes allocations
 */
import './load-env';
import { PrismaClient } from '@prisma/client';
import { matchBatchedSettlements } from '../src/lib/settlement-matching';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Settlement re-match (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const accounts = await db.financialAccount.findMany({
    where: { squareConnectionId: { not: null } },
    select: { id: true, name: true, userId: true },
  });

  if (!accounts.length) {
    console.log('No processor-linked accounts found. Nothing to do.');
    return;
  }

  for (const account of accounts) {
    const summary = await matchBatchedSettlements(db, account.userId, account.id, {
      apply: APPLY,
    });
    console.log(`\n${account.name}:`);
    console.log(`  payout days examined      : ${summary.daysExamined}`);
    console.log(`  settlements linked        : ${summary.linkedSettlements}`);
    console.log(`  deposits they resolve to  : ${summary.linkedDeposits}`);
    console.log(`  ambiguous (needs review)  : ${summary.ambiguousSettlements}`);
    if (summary.ambiguousDays.length) {
      console.log(`    on days: ${summary.ambiguousDays.join(', ')}`);
    }
    console.log(`  unexplained               : ${summary.unexplainedSettlements}`);
  }

  if (!APPLY) console.log('\nRe-run with --apply to write.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
