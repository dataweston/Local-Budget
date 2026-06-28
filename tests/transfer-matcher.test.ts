import { describe, it, expect } from 'vitest';
import {
  matchInternalTransfers,
  type TransferCandidate,
} from '@/lib/transfers/matcher';

const d = (s: string) => new Date(s);

function cand(p: Partial<TransferCandidate> & { id: string; accountId: string; signedAmount: number; date: Date }): TransferCandidate {
  return {
    entityType: null,
    type: 'TRANSFER',
    classification: null,
    ...p,
  };
}

describe('matchInternalTransfers', () => {
  it('pairs a debit with the matching credit in another account', () => {
    const res = matchInternalTransfers([
      cand({ id: 'out', accountId: 'A', signedAmount: -500, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'B', signedAmount: 500, date: d('2026-06-02') }),
    ]);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0]).toMatchObject({ outflowId: 'out', inflowId: 'in', amount: 500 });
    expect(res.matchedIds.has('out')).toBe(true);
    expect(res.matchedIds.has('in')).toBe(true);
    expect(res.unmatchedInflows).toHaveLength(0);
  });

  it('does not pair within the same account', () => {
    const res = matchInternalTransfers([
      cand({ id: 'out', accountId: 'A', signedAmount: -500, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'A', signedAmount: 500, date: d('2026-06-01') }),
    ]);
    expect(res.matches).toHaveLength(0);
    expect(res.unmatchedInflows).toHaveLength(1);
  });

  it('respects the date window', () => {
    const res = matchInternalTransfers(
      [
        cand({ id: 'out', accountId: 'A', signedAmount: -500, date: d('2026-06-01') }),
        cand({ id: 'in', accountId: 'B', signedAmount: 500, date: d('2026-06-20') }),
      ],
      { maxDayGap: 3 }
    );
    expect(res.matches).toHaveLength(0);
  });

  it('flags business -> personal as an owner draw (boundary crossing)', () => {
    const res = matchInternalTransfers([
      cand({ id: 'out', accountId: 'biz', entityType: 'BUSINESS', signedAmount: -2000, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'mine', entityType: 'PERSON', signedAmount: 2000, date: d('2026-06-01') }),
    ]);
    expect(res.matches[0].crossesBoundary).toBe(true);
    expect(res.matches[0].boundary).toBe('business_to_personal');
  });

  it('flags personal -> business as an owner contribution', () => {
    const res = matchInternalTransfers([
      cand({ id: 'out', accountId: 'mine', entityType: 'PERSON', signedAmount: -1000, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'biz', entityType: 'BUSINESS', signedAmount: 1000, date: d('2026-06-01') }),
    ]);
    expect(res.matches[0].boundary).toBe('personal_to_business');
  });

  it('treats within-side moves as non-boundary (checking -> savings)', () => {
    const res = matchInternalTransfers([
      cand({ id: 'out', accountId: 'chk', entityType: 'PERSON', signedAmount: -300, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'sav', entityType: 'PERSON', signedAmount: 300, date: d('2026-06-01') }),
    ]);
    expect(res.matches[0].crossesBoundary).toBe(false);
    expect(res.matches[0].boundary).toBe('within_side');
  });

  it('reports inbound money with no counterpart as a candidate income/investor exception', () => {
    const res = matchInternalTransfers([
      cand({ id: 'investor', accountId: 'biz', entityType: 'BUSINESS', signedAmount: 25000, date: d('2026-06-01') }),
      cand({ id: 'out', accountId: 'A', signedAmount: -500, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'B', signedAmount: 500, date: d('2026-06-01') }),
    ]);
    expect(res.matches).toHaveLength(1);
    expect(res.unmatchedInflows.map((c) => c.id)).toEqual(['investor']);
  });

  it('tolerates small fee differences between legs', () => {
    const res = matchInternalTransfers(
      [
        cand({ id: 'out', accountId: 'A', signedAmount: -500.0, date: d('2026-06-01') }),
        cand({ id: 'in', accountId: 'B', signedAmount: 499.99, date: d('2026-06-01') }),
      ],
      { amountTolerance: 0.01 }
    );
    expect(res.matches).toHaveLength(1);
  });

  it('does not reuse one inflow for two outflows', () => {
    const res = matchInternalTransfers([
      cand({ id: 'out1', accountId: 'A', signedAmount: -500, date: d('2026-06-01') }),
      cand({ id: 'out2', accountId: 'A', signedAmount: -500, date: d('2026-06-01') }),
      cand({ id: 'in', accountId: 'B', signedAmount: 500, date: d('2026-06-01') }),
    ]);
    expect(res.matches).toHaveLength(1);
  });
});
