type TransferCheckInput = {
  type?: string | null;
  classification?: string | null;
  category?: {
    defaultClassification?: string | null;
  } | null;
};

export function isTransferLikeTransaction(tx: TransferCheckInput): boolean {
  return (
    tx.type === 'TRANSFER' ||
    tx.classification === 'TRANSFER' ||
    tx.category?.defaultClassification === 'TRANSFER'
  );
}

export function isExpenseForSpending(tx: TransferCheckInput): boolean {
  return tx.type === 'EXPENSE' && !isTransferLikeTransaction(tx);
}
