/**
 * Heuristics for retroactively repairing classification mistakes that the
 * write-time guards (see categorizer.ts / rules.ts) now prevent going forward
 * but cannot undo on data classified before they existed.
 */

/**
 * Wording that marks a genuine internal transfer (money moved between the
 * owner's own accounts). An INCOME-type transaction carrying this wording is
 * correctly classified TRANSFER and must NOT be flipped back to revenue.
 *
 * Kept deliberately broad: a false "looks like a transfer" only leaves a row
 * out of the review queue (status quo), whereas a missed transfer would offer
 * a real transfer up for reclassification to revenue — the worse error.
 */
const TRANSFER_WORDING =
  /(transfer|from (joint|checking|savings|sav|chk|mma|money market)|deposit from (checking|savings|sav)|to (joint|checking|savings)|online transfer|internal|wire (in|transfer)|withdrawal|overdraft protection|atm)/i;

/**
 * True when an INCOME transaction currently marked TRANSFER looks like it is
 * actually revenue (a customer/processor payment) rather than an internal
 * move — i.e. a candidate for the retroactive revenue-recovery review queue.
 */
export function looksLikeMisclassifiedRevenue(tx: {
  type: string;
  classification: string | null;
  merchantName: string | null;
  description: string | null;
}): boolean {
  if (tx.type !== 'INCOME' || tx.classification !== 'TRANSFER') return false;
  const text = `${tx.merchantName ?? ''} ${tx.description ?? ''}`;
  return !TRANSFER_WORDING.test(text);
}
