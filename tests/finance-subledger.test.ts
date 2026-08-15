import { describe, expect, it } from 'vitest';
import { transactionBalanceEffect } from '@/lib/financial-integrity';
import {
  checkSettlementEntries,
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
