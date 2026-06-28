import { describe, it, expect } from 'vitest';
import { getVenmoBankRouting, isVenmoTransactionText } from '@/lib/venmo-routing';

describe('getVenmoBankRouting', () => {
  it('routes a bank<->Venmo cashout as a transfer', () => {
    expect(getVenmoBankRouting({ description: 'VENMO CASHOUT' })).toEqual({
      type: 'TRANSFER',
      classification: 'TRANSFER',
    });
  });

  it('routes a standard Venmo bank transfer as a transfer', () => {
    expect(
      getVenmoBankRouting({ description: 'Venmo standard transfer', merchantName: 'Venmo' })
    ).not.toBeNull();
  });

  it('does NOT force a generic Venmo payment to transfer (could be income)', () => {
    // Income hits the Venmo wallet; this must flow to normal classification.
    expect(getVenmoBankRouting({ description: 'Venmo payment', merchantName: 'Venmo' })).toBeNull();
  });

  it('returns null for non-Venmo text', () => {
    expect(getVenmoBankRouting({ description: 'Costco wholesale' })).toBeNull();
  });

  it('still detects Venmo text broadly', () => {
    expect(isVenmoTransactionText({ description: 'VENMO PAYMENT 12345' })).toBe(true);
  });
});
