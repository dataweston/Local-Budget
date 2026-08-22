/**
 * Guard for processor-ledger accounts.
 *
 * An account linked to a payment processor (currently Square) mirrors that
 * processor's own books: it holds the *gross capture* side of a sale, recorded
 * when the customer pays. Days later the processor deposits the same money —
 * net of fees, refunds, and any financing withheld — into a real bank account,
 * where Plaid records it again. Both rows are correct and both are wanted: the
 * pair is what makes fees visible at all.
 *
 * Operating reports use the originating processor activity and exclude its
 * matched bank settlement. Cash reports use the bank posting and exclude this
 * processor mirror. See reporting-scope.ts.
 *
 * These helpers make that failure mode loud instead of silent. They deliberately
 * do not block classifying one transaction by hand: that is a deliberate act on
 * a visible row, not the accident this guards against.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export const PROCESSOR_LEDGER_REASON =
  'These transactions belong to a payment-processor ledger account. They mirror ' +
  'gross sales and settlement deductions. Operating reports read these rows while ' +
  'cash reports read the bank settlement, so bulk classification can break the ' +
  'reporting boundary. Review them through processor reporting instead.';

/**
 * Account scope for cash totals and work queues — the owner's accounts
 * excluding any processor ledger. Operating reports use operatingReportScope.
 *
 * Listings, operating reports, and detail views may still include processor
 * rows; cash totals must not.
 *
 * Use in `where: { account: ledgerAccountScope(userId) }`.
 */
export function ledgerAccountScope(userId: string) {
  return { userId, squareConnectionId: null };
}

/**
 * Accounts that mirror a processor's ledger. Derived from the Square link
 * rather than a stored flag, so it stays correct without a migration and
 * without anyone having to remember to set something.
 */
export async function processorLedgerAccountIds(
  db: Db,
  userId?: string
): Promise<string[]> {
  const accounts = await db.financialAccount.findMany({
    where: {
      squareConnectionId: { not: null },
      ...(userId ? { userId } : {}),
    },
    select: { id: true },
  });
  return accounts.map((account) => account.id);
}

/**
 * A `where` fragment that keeps a bulk pass off processor-ledger accounts.
 * Returns an empty object when there are none, so it is always safe to spread.
 */
export function excludeProcessorLedger(
  accountIds: readonly string[]
): Prisma.TransactionWhereInput {
  return accountIds.length ? { accountId: { notIn: [...accountIds] } } : {};
}

/**
 * Which of the given transactions sit on a processor ledger. Callers applying a
 * classification to an explicit selection should refuse rather than silently
 * skip: the user picked those rows, so dropping them without a word would be
 * its own surprise.
 */
export function partitionProcessorLedger<T extends { accountId: string }>(
  transactions: readonly T[],
  processorAccountIds: readonly string[]
): { protected: T[]; classifiable: T[] } {
  if (!processorAccountIds.length) {
    return { protected: [], classifiable: [...transactions] };
  }
  const guarded = new Set(processorAccountIds);
  return {
    protected: transactions.filter((t) => guarded.has(t.accountId)),
    classifiable: transactions.filter((t) => !guarded.has(t.accountId)),
  };
}
