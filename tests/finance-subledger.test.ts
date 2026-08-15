import { describe, expect, it } from 'vitest';
import { transactionBalanceEffect } from '@/lib/financial-integrity';
import {
  excludeProcessorLedger,
  partitionProcessorLedger,
} from '@/lib/processor-ledger';
import {
  checkSettlementEntries,
  findExactSubset,
  settlementBankDateWindow,
  settlementReconciliationStatus,
} from '@/lib/settlements';

describe('cash posting balance effects', () => {
  it('excludes non-posted lifecycle states from account balances', () => {
    expect(
      transactionBalanceEffect({ amount: 100, type: 'INCOME', status: 'REMOVED' })
    ).toBe(0);
    expect(
      transactionBalanceEffect({ amount: 100, type: 'EXPENSE', status: 'CANCELLED' })
    ).toBe(0);
  });

  it('uses explicit transfer direction instead of treating every transfer as an inflow', () => {
    expect(
      transactionBalanceEffect({
        amount: 4850,
        type: 'TRANSFER',
        status: 'POSTED',
        metadata: { transferDirection: 'out' },
      })
    ).toBe(-4850);
    expect(
      transactionBalanceEffect({
        amount: 4850,
        type: 'TRANSFER',
        status: 'POSTED',
        metadata: { transferDirection: 'in' },
      })
    ).toBe(4850);
    expect(
      transactionBalanceEffect({
        amount: 4850,
        type: 'TRANSFER',
        status: 'POSTED',
      })
    ).toBe(0);
  });
});

describe('processor settlement reconciliation', () => {
  it('accepts a payout explained by gross receipts, fees, and financing deductions', () => {
    const check = checkSettlementEntries(4850, [5120, -170, -100]);
    expect(check).toEqual({
      entryNetAmount: 4850,
      mismatchCents: 0,
      balanced: true,
    });
    expect(
      settlementReconciliationStatus({
        entryCount: 3,
        entriesBalanced: check.balanced,
        bankMatchCount: 1,
      })
    ).toBe('MATCHED');
  });

  it('keeps ambiguous or arithmetically incomplete settlements partial', () => {
    expect(
      settlementReconciliationStatus({
        entryCount: 2,
        entriesBalanced: false,
        bankMatchCount: 1,
      })
    ).toBe('PARTIAL');
    expect(
      settlementReconciliationStatus({
        entryCount: 3,
        entriesBalanced: true,
        bankMatchCount: 2,
      })
    ).toBe('PARTIAL');
  });

  it('uses a bounded bank-settlement date window', () => {
    const { from, to } = settlementBankDateWindow(
      new Date('2026-08-15T12:00:00.000Z')
    );
    expect(from.toISOString()).toBe('2026-08-13T12:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-20T12:00:00.000Z');
  });
});

describe('processor-ledger classification guard', () => {
  const rows = [
    { id: 't1', accountId: 'square' },
    { id: 't2', accountId: 'bank' },
    { id: 't3', accountId: 'square' },
  ];

  it('separates processor-ledger rows from classifiable ones', () => {
    const split = partitionProcessorLedger(rows, ['square']);
    expect(split.protected.map((r) => r.id)).toEqual(['t1', 't3']);
    expect(split.classifiable.map((r) => r.id)).toEqual(['t2']);
  });

  it('leaves everything classifiable when no processor account exists', () => {
    const split = partitionProcessorLedger(rows, []);
    expect(split.protected).toEqual([]);
    expect(split.classifiable).toHaveLength(3);
  });

  it('produces a spreadable where-fragment, empty when unguarded', () => {
    expect(excludeProcessorLedger(['square'])).toEqual({
      accountId: { notIn: ['square'] },
    });
    // Must stay safe to spread into a query that should match everything.
    expect(excludeProcessorLedger([])).toEqual({});
  });
});

describe('batched payout subset matching', () => {
  const c = (id: string, cents: number) => ({ item: id, cents });

  it('finds the group of payouts that makes up one bank deposit', () => {
    const match = findExactSubset(
      [c('a', 1200), c('b', 3450), c('c', 875), c('d', 9900)],
      4325 // b + c
    );
    expect(match).not.toBeNull();
    expect(match!.items.sort()).toEqual(['b', 'c']);
    expect(match!.unique).toBe(true);
  });

  it('flags an ambiguous grouping instead of binding the wrong payouts', () => {
    // 500 + 700 and 1200 both reach the deposit total; auto-accepting either
    // would silently attribute revenue to the wrong payouts.
    const match = findExactSubset([c('a', 500), c('b', 700), c('c', 1200)], 1200);
    expect(match).not.toBeNull();
    expect(match!.unique).toBe(false);
  });

  it('matches a single payout without special-casing it', () => {
    const match = findExactSubset([c('a', 2500), c('b', 4000)], 2500);
    expect(match!.items).toEqual(['a']);
    expect(match!.unique).toBe(true);
  });

  it('returns null when no combination reaches the deposit', () => {
    expect(findExactSubset([c('a', 100), c('b', 250)], 999)).toBeNull();
    expect(findExactSubset([c('a', 100)], 0)).toBeNull();
  });

  it('ignores negative and oversized rows rather than mixing them in', () => {
    // Returned payouts / reversals settle on their own rows.
    const match = findExactSubset([c('refund', -400), c('a', 600), c('big', 90_000)], 600);
    expect(match!.items).toEqual(['a']);
    expect(match!.unique).toBe(true);
  });

  it('bails out instead of exploding on an unbounded candidate set', () => {
    const many = Array.from({ length: 200 }, (_, i) => c(`p${i}`, 100 + i));
    expect(findExactSubset(many, 50_000, { maxCandidates: 64 })).toBeNull();
  });
});
