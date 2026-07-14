import { describe, expect, it } from 'vitest';
import {
  buildCashflowMonths,
  costBucketFor,
  dollarsToCents,
  effectiveCashflowClassification,
} from '@/lib/cashflow';

describe('cashflow actuals', () => {
  it('uses integer cents and rejects invalid amounts', () => {
    expect(dollarsToCents('12.345')).toBe(1235);
    expect(() => dollarsToCents('nope')).toThrow('Invalid monetary amount');
  });

  it('applies split classification precedence exactly', () => {
    expect(effectiveCashflowClassification(
      { classification: null, category: { defaultClassification: 'COGS' } },
      { classification: 'OPERATING', category: { defaultClassification: 'PERSONAL' } }
    )).toBe('COGS');
    expect(effectiveCashflowClassification(
      { classification: null, category: null },
      { classification: null, category: { defaultClassification: null } }
    )).toBeNull();
  });

  it('recognizes explicit labor evidence without treating arbitrary people transfers as labor', () => {
    expect(costBucketFor({ classification: null, categoryName: 'Labor', type: 'EXPENSE' }).costBucket)
      .toBe('LABOR');
    expect(costBucketFor({ classification: 'OPERATING', merchantName: 'Square Payroll', type: 'EXPENSE' }))
      .toEqual({ costBucket: 'LABOR', costSubcategory: 'GROSS_WAGES' });
    expect(costBucketFor({ classification: null, merchantName: 'Zelle to Pat', type: 'EXPENSE' }).costBucket)
      .toBe('UNCLASSIFIED');
  });

  it('uses split lines, detects mismatches, and never hides unresolved outflow in operating', () => {
    const result = buildCashflowMonths({
      from: '2026-01-01',
      toExclusive: '2026-02-01',
      sourceMaxDate: '2026-02-03',
      transactions: [
        {
          id: 'split', date: new Date('2026-01-10T00:00:00Z'), amount: 100, type: 'EXPENSE',
          status: 'POSTED', classification: 'OPERATING', category: null,
          splits: [
            { amount: 60, classification: 'COGS', category: null },
            { amount: 39.98, classification: null, category: null },
          ],
        },
        {
          id: 'pending', date: new Date('2026-01-11T00:00:00Z'), amount: 50, type: 'EXPENSE',
          status: 'PENDING', classification: 'OPERATING', category: null, splits: [],
        },
        {
          id: 'unknown', date: new Date('2026-01-12T00:00:00Z'), amount: 25, type: 'EXPENSE',
          status: 'POSTED', classification: null, category: null, splits: [],
        },
      ],
    });

    expect(result.months[0]).toMatchObject({
      inventoryCents: 6000,
      operatingCents: 3998,
      unclassifiedCents: 2500,
      transactionCount: 2,
      splitLineCount: 2,
      complete: true,
    });
    expect(result.splitMismatchCount).toBe(1);
    expect(result.unclassifiedTransactionCount).toBe(1);
  });
});
