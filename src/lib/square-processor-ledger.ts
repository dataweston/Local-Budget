/**
 * Select the one account allowed to ingest a Square connection's processor
 * activity. A Square destination bank account is a settlement target, not a
 * second copy of Square's ledger.
 *
 * The selector intentionally fails closed when an old, ambiguous connection
 * has multiple unmarked accounts. Sending one payment to different accounts
 * defeats the per-account external-id uniqueness constraint and creates a
 * duplicate that later reconciliation cannot safely remove.
 */
export type SquareLinkedAccount = {
  id: string;
  providerData?: unknown;
};

export type SquareProcessorAccountSelection<T extends SquareLinkedAccount> =
  | { account: T; reason: 'tagged' | 'single-legacy' }
  | { account: undefined; reason: 'missing' | 'ambiguous-legacy' | 'ambiguous-tagged' };

function providerName(providerData: unknown): string | undefined {
  if (!providerData || typeof providerData !== 'object' || Array.isArray(providerData)) {
    return undefined;
  }
  const provider = (providerData as Record<string, unknown>).provider;
  return typeof provider === 'string' ? provider : undefined;
}

/** True only for the account that mirrors Square's gross processor ledger. */
export function isSquareProcessorLedgerAccount(account: SquareLinkedAccount): boolean {
  return providerName(account.providerData) === 'square';
}

/** A bank account Square pays out to; it must be ingested by its bank feed. */
export function isSquareDestinationBankAccount(account: SquareLinkedAccount): boolean {
  return providerName(account.providerData) === 'square_bank';
}

export function selectSquareProcessorLedgerAccount<T extends SquareLinkedAccount>(
  accounts: readonly T[]
): SquareProcessorAccountSelection<T> {
  const tagged = accounts.filter(isSquareProcessorLedgerAccount);
  if (tagged.length === 1) return { account: tagged[0], reason: 'tagged' };
  if (tagged.length > 1) return { account: undefined, reason: 'ambiguous-tagged' };

  // One unmarked legacy account is unambiguous. Do not guess once there are
  // several candidates: an explicit reconnect creates a correctly tagged
  // ledger account without altering the historical accounts or their rows.
  const legacyCandidates = accounts.filter(
    (account) => !isSquareDestinationBankAccount(account)
  );
  if (legacyCandidates.length === 1) {
    return { account: legacyCandidates[0], reason: 'single-legacy' };
  }
  return {
    account: undefined,
    reason: legacyCandidates.length === 0 ? 'missing' : 'ambiguous-legacy',
  };
}
