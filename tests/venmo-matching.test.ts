import { describe, expect, it } from 'vitest';
import {
  getVenmoCandidateAmounts,
  venmoExpectsBankCounterpart,
} from '@/lib/venmo-matching';

describe('Venmo bank matching', () => {
  it('matches instant-transfer deposits at gross and fee-adjusted amounts', () => {
    expect(
      getVenmoCandidateAmounts({
        type: 'Instant Transfer',
        amountTotalSigned: -72,
        amountFeeSigned: -1.26,
        fundingSource: '',
      })
    ).toEqual([
      { amount: 72, basis: 'TOTAL' },
      { amount: 70.74, basis: 'TOTAL_MINUS_FEE' },
      { amount: 73.26, basis: 'TOTAL_PLUS_FEE' },
    ]);
  });

  it('expects a bank duplicate for externally funded spending', () => {
    expect(
      venmoExpectsBankCounterpart({
        type: 'Payment',
        amountTotalSigned: -20,
        amountFeeSigned: 0,
        fundingSource: 'JPMORGAN CHASE Personal Checking *7374',
      })
    ).toBe(true);
  });

  it('does not match wallet-balance spending to an unrelated bank row', () => {
    expect(
      venmoExpectsBankCounterpart({
        type: 'Payment',
        amountTotalSigned: -20,
        amountFeeSigned: 0,
        fundingSource: 'Venmo balance',
      })
    ).toBe(false);
  });

  it('does not expect customer income to duplicate in a bank account', () => {
    expect(
      venmoExpectsBankCounterpart({
        type: 'Payment',
        amountTotalSigned: 230,
        amountFeeSigned: 0,
        fundingSource: '',
      })
    ).toBe(false);
  });
});
