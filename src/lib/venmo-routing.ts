type TxTextInput = {
  description?: string | null;
  merchantName?: string | null;
};

export function isVenmoTransactionText(input: TxTextInput): boolean {
  const text = `${input.description ?? ''} ${input.merchantName ?? ''}`.toLowerCase();
  return text.includes('venmo');
}

// A bank<->Venmo wallet move (cashout / standard transfer / add-funds). These
// are genuine internal transfers between the owner's bank and Venmo wallet.
// Crucially NOT every Venmo row: a "Venmo payment" can be real income/expense
// (a customer paying you, you paying a person), which must NOT be force-hidden.
const VENMO_WALLET_MOVE =
  /(cashout|cash out|venmo.*(transfer|withdrawal|payment from venmo)|standard transfer|instant transfer|added? (money|funds)|bank transfer)/i;

/**
 * Returns TRANSFER routing only for a bank<->Venmo wallet move; otherwise null
 * so the row flows through normal income/expense classification.
 *
 * Previously this forced EVERY Venmo row to TRANSFER, silently hiding Venmo
 * income (income hits the Venmo wallet). Now it's scoped to actual wallet moves.
 */
export function getVenmoBankRouting(input: TxTextInput): {
  type: 'TRANSFER';
  classification: 'TRANSFER';
} | null {
  if (!isVenmoTransactionText(input)) return null;
  const text = `${input.description ?? ''} ${input.merchantName ?? ''}`;
  if (!VENMO_WALLET_MOVE.test(text)) return null;
  return {
    type: 'TRANSFER',
    classification: 'TRANSFER',
  };
}

