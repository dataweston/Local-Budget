export const SETTLEMENT_TOLERANCE_CENTS = 1;

export function checkSettlementEntries(
  settlementAmount: number,
  entryNetAmounts: readonly number[]
) {
  const entryNetAmount = entryNetAmounts.reduce((sum, amount) => sum + amount, 0);
  const mismatchCents = Math.round((entryNetAmount - settlementAmount) * 100);
  return {
    entryNetAmount,
    mismatchCents,
    balanced: Math.abs(mismatchCents) <= SETTLEMENT_TOLERANCE_CENTS,
  };
}

export function settlementReconciliationStatus(input: {
  entryCount: number;
  entriesBalanced: boolean;
  bankMatchCount: number;
}): 'UNMATCHED' | 'PARTIAL' | 'MATCHED' {
  if (input.entryCount === 0) return 'UNMATCHED';
  if (!input.entriesBalanced) return 'PARTIAL';
  return input.bankMatchCount === 1 ? 'MATCHED' : 'PARTIAL';
}

export function settlementBankDateWindow(effectiveAt: Date) {
  const from = new Date(effectiveAt);
  const to = new Date(effectiveAt);
  from.setUTCDate(from.getUTCDate() - 2);
  to.setUTCDate(to.getUTCDate() + 5);
  return { from, to };
}

/**
 * Square does not always deposit one payout per bank credit: on 33 of 96 payout
 * days it batches several payouts into a single deposit, which is why matching
 * payouts to deposits one-for-one resolves only about half of them.
 *
 * `findExactSubset` looks for a group of payouts whose amounts sum exactly to a
 * deposit. It works in integer cents (float addition does not survive a
 * subset-sum comparison) and reports whether the answer was unique, because an
 * ambiguous answer must never be auto-accepted: with dozens of small same-day
 * payouts, more than one combination can hit the same total by coincidence, and
 * binding the wrong one silently mis-attributes revenue. Callers should treat a
 * non-unique result the way a multi-candidate single match is treated — leave it
 * PARTIAL for a human.
 *
 * Exhaustive over reachable sums rather than over combinations, so cost is
 * bounded by the deposit total rather than by 2^n.
 */
export interface SubsetCandidate<T> {
  readonly item: T;
  readonly cents: number;
}

export interface SubsetMatch<T> {
  items: T[];
  unique: boolean;
}

export function findExactSubset<T>(
  candidates: readonly SubsetCandidate<T>[],
  targetCents: number,
  options: { maxCandidates?: number; maxReachableSums?: number } = {}
): SubsetMatch<T> | null {
  const maxCandidates = options.maxCandidates ?? 64;
  const maxReachableSums = options.maxReachableSums ?? 200_000;
  if (!Number.isFinite(targetCents) || targetCents <= 0) return null;

  // Only positive amounts can contribute to a positive target; negative rows
  // (returned payouts, reversals) settle on their own and never combine here.
  const usable = candidates.filter((c) => Number.isFinite(c.cents) && c.cents > 0 && c.cents <= targetCents);
  if (!usable.length || usable.length > maxCandidates) return null;
  if (usable.reduce((sum, c) => sum + c.cents, 0) < targetCents) return null;

  // sum -> how we first reached it, plus a way-count saturated at 2 (we only
  // need "exactly one" vs "more than one"). Parent pointers rather than arrays:
  // copying a picks[] per reachable sum dominates the runtime otherwise.
  const reached = new Map<number, { via: number; from: number; ways: number }>();
  reached.set(0, { via: -1, from: -1, ways: 1 });

  for (let index = 0; index < usable.length; index++) {
    const { cents } = usable[index];
    const additions: [number, { via: number; from: number; ways: number }][] = [];
    for (const [sum, entry] of Array.from(reached.entries())) {
      const next = sum + cents;
      if (next > targetCents) continue;
      const existing = reached.get(next);
      additions.push([
        next,
        {
          via: existing ? existing.via : index,
          from: existing ? existing.from : sum,
          ways: Math.min(2, (existing?.ways ?? 0) + entry.ways),
        },
      ]);
    }
    for (const [sum, entry] of additions) reached.set(sum, entry);
    if (reached.size > maxReachableSums) return null;
  }

  const hit = reached.get(targetCents);
  if (!hit || hit.via < 0) return null;

  const items: T[] = [];
  for (let sum = targetCents, guard = 0; sum > 0 && guard <= usable.length; guard++) {
    const step = reached.get(sum);
    if (!step || step.via < 0) return null;
    items.push(usable[step.via].item);
    sum = step.from;
  }
  return { items, unique: hit.ways === 1 };
}
