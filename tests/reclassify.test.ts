import { describe, it, expect } from 'vitest';
import { looksLikeMisclassifiedRevenue } from '@/lib/reclassify';

const base = { type: 'INCOME', classification: 'TRANSFER' as string | null };

describe('looksLikeMisclassifiedRevenue', () => {
  it('flags customer/processor payments wrongly marked TRANSFER', () => {
    expect(
      looksLikeMisclassifiedRevenue({
        ...base,
        merchantName: null,
        description: 'Zelle® Payment from Catherine Olsen',
      })
    ).toBe(true);
    expect(
      looksLikeMisclassifiedRevenue({
        ...base,
        merchantName: null,
        description: 'ID - CTvree41',
      })
    ).toBe(true);
  });

  it('leaves genuine internal transfers alone', () => {
    for (const description of [
      'Online Transfer from SAV ...7680',
      'From Joint Checking - 6183',
      'Deposit From Savings - 8273',
      'Transfer in',
    ]) {
      expect(
        looksLikeMisclassifiedRevenue({ ...base, merchantName: null, description })
      ).toBe(false);
    }
  });

  it('only considers INCOME transactions marked TRANSFER', () => {
    expect(
      looksLikeMisclassifiedRevenue({
        type: 'EXPENSE',
        classification: 'TRANSFER',
        merchantName: 'Whatever',
        description: 'something',
      })
    ).toBe(false);
    expect(
      looksLikeMisclassifiedRevenue({
        type: 'INCOME',
        classification: 'INCOME',
        merchantName: 'Customer',
        description: 'payment',
      })
    ).toBe(false);
  });
});
