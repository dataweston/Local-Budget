type TxTextInput = {
  description?: string | null;
  merchantName?: string | null;
};

export function isVenmoTransactionText(input: TxTextInput): boolean {
  const text = `${input.description ?? ''} ${input.merchantName ?? ''}`.toLowerCase();
  return text.includes('venmo');
}

export function getVenmoBankRouting(input: TxTextInput): {
  type: 'TRANSFER';
  classification: 'TRANSFER';
} | null {
  if (!isVenmoTransactionText(input)) return null;
  return {
    type: 'TRANSFER',
    classification: 'TRANSFER',
  };
}

