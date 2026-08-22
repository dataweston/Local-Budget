export type VenmoMatchAmountBasis = 'TOTAL' | 'TOTAL_MINUS_FEE' | 'TOTAL_PLUS_FEE';

export type VenmoBankMatchInput = {
  type: string;
  amountTotalSigned: number;
  amountFeeSigned: number;
  fundingSource: string;
};

export function venmoExpectsBankCounterpart(entry: VenmoBankMatchInput): boolean {
  if (entry.type.toLowerCase().includes('transfer')) return true;
  const fundingSource = entry.fundingSource.trim().toLowerCase();
  const hasExternalFundingSource =
    !!fundingSource && !fundingSource.includes('venmo balance');
  return entry.amountTotalSigned < 0 && hasExternalFundingSource;
}

export function getVenmoCandidateAmounts(entry: VenmoBankMatchInput): Array<{
  amount: number;
  basis: VenmoMatchAmountBasis;
}> {
  const total = Math.abs(entry.amountTotalSigned);
  const fee = Math.abs(entry.amountFeeSigned);
  const values: Array<{ amount: number; basis: VenmoMatchAmountBasis }> = [
    { amount: total, basis: 'TOTAL' },
  ];
  if (fee > 0 && total - fee > 0) {
    values.push({ amount: Number((total - fee).toFixed(2)), basis: 'TOTAL_MINUS_FEE' });
  }
  if (fee > 0) {
    values.push({ amount: Number((total + fee).toFixed(2)), basis: 'TOTAL_PLUS_FEE' });
  }
  return values;
}
