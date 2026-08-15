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
