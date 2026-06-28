/**
 * Internal-transfer reconciliation.
 *
 * The owner's accounts (checking/savings for self + spouse, business checking,
 * Venmo wallet) constantly move money between each other. Those moves are NOT
 * income or expense — they should cancel out. This module pairs a debit in one
 * internal account with the matching credit in another and classifies both as
 * TRANSFER, while flagging the pairs that matter:
 *
 *   - boundary-crossing transfers (business <-> personal) = owner draw /
 *     owner contribution — real economic events to review, not noise.
 *   - inbound money to an internal account with NO matching internal
 *     counterpart = candidate true income / investor funds, not a transfer.
 *
 * The matching here is pure and unit-tested; persistence lives in the caller.
 */

export type TransferCandidate = {
  id: string;
  accountId: string;
  /** PERSON | BUSINESS | PROJECT | null — the owning entity's type. */
  entityType: string | null;
  /** Signed amount: positive = money in (credit), negative = money out (debit). */
  signedAmount: number;
  date: Date;
  type: string;
  classification: string | null;
};

export type MatchOptions = {
  /** Max days between the two legs of a transfer. */
  maxDayGap?: number;
  /** Absolute dollars two legs may differ and still match (fees/rounding). */
  amountTolerance?: number;
};

export type TransferMatch = {
  outflowId: string;
  inflowId: string;
  amount: number;
  dayGap: number;
  /** True when the two legs sit on opposite sides of the business boundary. */
  crossesBoundary: boolean;
  /** Direction of the boundary crossing, when applicable. */
  boundary: 'business_to_personal' | 'personal_to_business' | 'within_side' | null;
};

export type MatchResult = {
  matches: TransferMatch[];
  /** Candidate ids that found a counterpart (both legs of every match). */
  matchedIds: Set<string>;
  /**
   * Inbound legs (money IN) that found no internal counterpart — likely true
   * income / investor funds rather than an internal transfer.
   */
  unmatchedInflows: TransferCandidate[];
};

const DEFAULT_MAX_DAY_GAP = 3;
const DEFAULT_AMOUNT_TOLERANCE = 0.01;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function isPersonalSide(entityType: string | null): boolean {
  // PERSON and PROJECT are treated as the personal side; BUSINESS is the
  // business side. Unknown entity is treated as personal (conservative — an
  // unknown account doesn't manufacture a phantom owner-draw).
  return entityType !== 'BUSINESS';
}

function boundaryFor(
  outflow: TransferCandidate,
  inflow: TransferCandidate
): TransferMatch['boundary'] {
  const outBusiness = outflow.entityType === 'BUSINESS';
  const inBusiness = inflow.entityType === 'BUSINESS';
  if (outBusiness === inBusiness) return 'within_side';
  // Money leaves business, lands personal => owner draw.
  if (outBusiness && !inBusiness) return 'business_to_personal';
  // Money leaves personal, lands business => owner contribution.
  return 'personal_to_business';
}

/**
 * Pair internal debits with internal credits. Greedy by closeness: each outflow
 * takes the nearest-in-time unused inflow of the same magnitude in a DIFFERENT
 * account. O(n^2) worst case but n is the transfer-eligible set, which is small.
 */
export function matchInternalTransfers(
  candidates: TransferCandidate[],
  options: MatchOptions = {}
): MatchResult {
  const maxDayGap = options.maxDayGap ?? DEFAULT_MAX_DAY_GAP;
  const tolerance = options.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE;

  const outflows = candidates
    .filter((c) => c.signedAmount < 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const inflows = candidates
    .filter((c) => c.signedAmount > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const usedInflow = new Set<string>();
  const matches: TransferMatch[] = [];
  const matchedIds = new Set<string>();

  for (const out of outflows) {
    const target = Math.abs(out.signedAmount);
    let best: { inflow: TransferCandidate; gap: number } | null = null;

    for (const inf of inflows) {
      if (usedInflow.has(inf.id)) continue;
      if (inf.accountId === out.accountId) continue; // must cross accounts
      if (Math.abs(Math.abs(inf.signedAmount) - target) > tolerance) continue;
      const gap = daysBetween(out.date, inf.date);
      if (gap > maxDayGap) continue;
      if (!best || gap < best.gap) best = { inflow: inf, gap };
    }

    if (best) {
      usedInflow.add(best.inflow.id);
      matchedIds.add(out.id);
      matchedIds.add(best.inflow.id);
      const boundary = boundaryFor(out, best.inflow);
      matches.push({
        outflowId: out.id,
        inflowId: best.inflow.id,
        amount: target,
        dayGap: best.gap,
        crossesBoundary: boundary !== 'within_side',
        boundary,
      });
    }
  }

  const unmatchedInflows = inflows.filter((inf) => !usedInflow.has(inf.id));

  return { matches, matchedIds, unmatchedInflows };
}

export { isPersonalSide };
