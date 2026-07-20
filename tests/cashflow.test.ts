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

  it('buckets PERSONAL outflows as founder draws, attributed only via incurredBy', () => {
    const result = buildCashflowMonths({
      from: '2026-01-01',
      toExclusive: '2026-02-01',
      sourceMaxDate: '2026-02-03',
      transactions: [
        {
          id: 'attributed', date: new Date('2026-01-05T00:00:00Z'), amount: 120, type: 'EXPENSE',
          status: 'POSTED', classification: 'PERSONAL', category: null,
          incurredBy: { name: 'Weston' }, splits: [],
        },
        {
          id: 'unattributed', date: new Date('2026-01-06T00:00:00Z'), amount: 80, type: 'EXPENSE',
          status: 'POSTED', classification: 'PERSONAL', category: null, splits: [],
        },
        {
          id: 'contribution', date: new Date('2026-01-07T00:00:00Z'), amount: 500, type: 'INCOME',
          status: 'POSTED', classification: 'PERSONAL', category: null, splits: [],
        },
      ],
    });

    expect(result.months[0].founderDraws).toEqual({
      totalCents: 20000,
      byFounder: { Weston: 12000 },
      unattributedCents: 8000,
    });
    // Personal money *in* is excluded from the draw bucket but still excluded from P&L.
    expect(result.months[0].personalExcludedCents).toBe(70000);
  });

  it('marks isCompleteMonth false when pending imports exist, even if posted data covers the month', () => {
    const base = {
      from: '2026-01-01',
      toExclusive: '2026-03-01',
      sourceMaxDate: '2026-03-05',
      transactions: [],
    };
    const withPending = buildCashflowMonths({
      ...base,
      pendingDates: [new Date('2026-01-15T00:00:00Z')],
    });
    expect(withPending.months[0]).toMatchObject({
      complete: true,
      pendingTransactionCount: 1,
      isCompleteMonth: false,
    });
    expect(withPending.months[1]).toMatchObject({ isCompleteMonth: true });

    const withoutPending = buildCashflowMonths(base);
    expect(withoutPending.months[0].isCompleteMonth).toBe(true);
  });
});
