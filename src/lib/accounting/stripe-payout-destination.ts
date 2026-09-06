export type StripePayoutDestination = {
  last4: string | null | undefined;
  currency: string | null | undefined;
};

export type DestinationAccountCandidate = {
  id: string;
  name: string;
  accountNumber: string | null;
  currency: string;
  isActive: boolean;
};

export type DestinationAccountMatch =
  | { status: 'matched'; account: DestinationAccountCandidate; evidenceBasis: string }
  | { status: 'ambiguous'; candidates: DestinationAccountCandidate[]; reason: string }
  | { status: 'unmatched'; candidates: []; reason: string };

const normalized = (value: string | null | undefined) => String(value || '').trim();

/**
 * Identify a destination account only from exact provider account evidence.
 * Amount and date are intentionally absent: neither can establish custody.
 */
export function matchStripePayoutDestinationAccount(
  destination: StripePayoutDestination,
  accounts: readonly DestinationAccountCandidate[]
): DestinationAccountMatch {
  const last4 = normalized(destination.last4);
  const currency = normalized(destination.currency).toUpperCase();
  if (!/^\d{4}$/.test(last4) || !currency) {
    return {
      status: 'unmatched',
      candidates: [],
      reason: 'Stripe destination last4 or currency is missing or invalid',
    };
  }

  const candidates = accounts
    .filter((account) => (
      account.isActive
      && normalized(account.accountNumber) === last4
      && normalized(account.currency).toUpperCase() === currency
    ))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (candidates.length === 0) {
    return {
      status: 'unmatched',
      candidates: [],
      reason: `No active ${currency} financial account ends in ${last4}`,
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates,
      reason: `${candidates.length} active ${currency} financial accounts end in ${last4}`,
    };
  }

  return {
    status: 'matched',
    account: candidates[0],
    evidenceBasis: `unique active ${currency} account with exact destination last4 ${last4}`,
  };
}
