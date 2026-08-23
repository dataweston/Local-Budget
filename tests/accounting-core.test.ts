import { describe, expect, it } from 'vitest';
import {
  assertExactReversal,
  assertJournalMutable,
  assertJournalPostable,
  JournalInvariantError,
  validateJournalLines,
} from '@/lib/accounting/journal';
import {
  normalizeSourceEventIdentity,
  sourceEventIdempotencyKey,
  SourceEventIdentityError,
} from '@/lib/accounting/source-events';

describe('source event identity', () => {
  it('scopes idempotency to tenant, provider, and source namespace', () => {
    const identity = normalizeSourceEventIdentity({
      userId: 'user-1',
      sourceSystem: ' square ',
      sourceNamespace: 'merchant-1',
      externalId: 'payment-7',
    });
    expect(identity.sourceSystem).toBe('SQUARE');
    expect(sourceEventIdempotencyKey(identity)).toBe(
      'user-1:SQUARE:merchant-1:payment-7'
    );
    expect(
      sourceEventIdempotencyKey({
        ...identity,
        sourceNamespace: 'merchant-2',
      })
    ).not.toBe(sourceEventIdempotencyKey(identity));
  });

  it('rejects blank identity components', () => {
    expect(() =>
      normalizeSourceEventIdentity({
        userId: 'user-1',
        sourceSystem: 'PLAID',
        sourceNamespace: ' ',
        externalId: 'txn-1',
      })
    ).toThrow(SourceEventIdentityError);
  });
});

describe('journal invariants', () => {
  const balanced = [
    { chartAccountId: 'cash', debitAmount: '100.00' },
    { chartAccountId: 'revenue', creditAmount: '100.00' },
  ];

  it('accepts balanced one-sided lines', () => {
    const result = validateJournalLines(balanced);
    expect(result.debitTotal.toFixed(2)).toBe('100.00');
    expect(result.creditTotal.toFixed(2)).toBe('100.00');
  });

  it('rejects an unbalanced entry', () => {
    expect(() =>
      assertJournalPostable({
        periodStatus: 'OPEN',
        lines: [
          { chartAccountId: 'cash', debitAmount: 100 },
          { chartAccountId: 'revenue', creditAmount: 99 },
        ],
      })
    ).toThrow(JournalInvariantError);
  });

  it('rejects zero, two-sided, negative, and over-precision lines', () => {
    expect(() => validateJournalLines([
      { chartAccountId: 'cash', debitAmount: 0 },
      { chartAccountId: 'revenue', creditAmount: 0 },
    ])).toThrow(JournalInvariantError);
    expect(() => validateJournalLines([
      { chartAccountId: 'cash', debitAmount: 1, creditAmount: 1 },
      { chartAccountId: 'revenue', creditAmount: 2 },
    ])).toThrow(JournalInvariantError);
    expect(() => validateJournalLines([
      { chartAccountId: 'cash', debitAmount: -1 },
      { chartAccountId: 'revenue', creditAmount: 1 },
    ])).toThrow(JournalInvariantError);
    expect(() => validateJournalLines([
      { chartAccountId: 'cash', debitAmount: '1.00001' },
      { chartAccountId: 'revenue', creditAmount: '1.00001' },
    ])).toThrow(JournalInvariantError);
  });

  it('rejects posting or mutation in a closed period', () => {
    expect(() =>
      assertJournalPostable({ periodStatus: 'CLOSED', lines: balanced })
    ).toThrow('closed accounting period');
    expect(() =>
      assertJournalMutable({ entryStatus: 'DRAFT', periodStatus: 'CLOSED' })
    ).toThrow('immutable');
    expect(() =>
      assertJournalMutable({ entryStatus: 'POSTED', periodStatus: 'OPEN' })
    ).toThrow('immutable');
  });

  it('requires linked reversals to exactly invert accounts and attribution', () => {
    const original = [
      {
        chartAccountId: 'cash',
        debitAmount: '100.00',
        legalOwnerId: 'business',
        custodyAccountId: 'square',
      },
      { chartAccountId: 'revenue', creditAmount: '100.00', legalOwnerId: 'business' },
    ];
    expect(() =>
      assertExactReversal(original, [
        {
          chartAccountId: 'cash',
          creditAmount: '100.00',
          legalOwnerId: 'business',
          custodyAccountId: 'square',
        },
        { chartAccountId: 'revenue', debitAmount: '100.00', legalOwnerId: 'business' },
      ])
    ).not.toThrow();
    expect(() =>
      assertExactReversal(original, [
        { chartAccountId: 'cash', creditAmount: '100.00', legalOwnerId: 'weston' },
        { chartAccountId: 'revenue', debitAmount: '100.00', legalOwnerId: 'business' },
      ])
    ).toThrow('exactly invert');
  });
});
