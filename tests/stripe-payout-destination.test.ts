import { describe, expect, it } from 'vitest';
import { matchStripePayoutDestinationAccount } from '@/lib/accounting/stripe-payout-destination';

const accounts = [
  {
    id: 'account-sofi-6183',
    name: 'SoFi Checking',
    accountNumber: '6183',
    currency: 'USD',
    isActive: true,
  },
  {
    id: 'account-card-0041-a',
    name: 'Card A',
    accountNumber: '0041',
    currency: 'USD',
    isActive: true,
  },
  {
    id: 'account-card-0041-b',
    name: 'Card B',
    accountNumber: '0041',
    currency: 'USD',
    isActive: true,
  },
] as const;

describe('Stripe payout destination account matching', () => {
  it('matches a unique active account by exact last4 and currency', () => {
    expect(matchStripePayoutDestinationAccount(
      { last4: '6183', currency: 'usd' },
      accounts
    )).toMatchObject({
      status: 'matched',
      account: { id: 'account-sofi-6183' },
      evidenceBasis: 'unique active USD account with exact destination last4 6183',
    });
  });

  it('is deterministic and refuses two candidate accounts', () => {
    const destination = { last4: '0041', currency: 'USD' };
    const forward = matchStripePayoutDestinationAccount(destination, accounts);
    const reverse = matchStripePayoutDestinationAccount(destination, [...accounts].reverse());

    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      status: 'ambiguous',
      reason: '2 active USD financial accounts end in 0041',
    });
    if (forward.status !== 'ambiguous') throw new Error('expected ambiguous result');
    expect(forward.candidates.map((candidate) => candidate.id)).toEqual([
      'account-card-0041-a',
      'account-card-0041-b',
    ]);
  });

  it('does not use amount or date as fallback evidence', () => {
    const destinationWithIncidentalFields = {
      last4: '9999',
      currency: 'USD',
      amount: 265.34,
      arrivalDate: '2024-01-19',
    };

    expect(matchStripePayoutDestinationAccount(
      destinationWithIncidentalFields,
      accounts
    )).toEqual({
      status: 'unmatched',
      candidates: [],
      reason: 'No active USD financial account ends in 9999',
    });
  });
});
