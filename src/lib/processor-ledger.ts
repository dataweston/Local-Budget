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
 * What must not happen is counting both as revenue. The ledger treats bank
 * deposits as revenue, and the only thing keeping the processor side out of
 * every P&L is that those rows carry `classification = null`. Nothing else
 * excludes them. So a single well-meant bulk pass over "unclassified"
 * transactions — exactly what `classify:nulls` is for — would silently double
 * the revenue line.
 *
 * These helpers make that failure mode loud instead of silent. They deliberately
 * do not block classifying one transaction by hand: that is a deliberate act on
 * a visible row, not the accident this guards against.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export const PROCESSOR_LEDGER_REASON =
  'These transactions belong to a payment-processor ledger account. They mirror ' +
  'the gross side of sales that are already counted as revenue via their bank ' +
  'deposits, so classifying them would count the same money twice. They are meant ' +
  'to stay unclassified.';

/**
 * Account scope for ledger *totals and work queues* — the owner's accounts
 * excluding any processor ledger.
 *
 * The rule this encodes: totals and queues exclude the processor ledger;
 * listings and detail views include it. A processor row is real and worth
 * looking at, but it is not revenue, not an expense, and not a task — it is the
 * gross side of money that is counted once, as a bank deposit. Feeding it into
 * a sum double-counts; feeding it into a review queue creates a backlog that
 * can never be cleared, because these rows are meant to stay unclassified.
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
