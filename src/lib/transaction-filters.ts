type TransferCheckInput = {
  type?: string | null;
  classification?: string | null;
  category?: {
    defaultClassification?: string | null;
  } | null;
};

export type EffectiveClassification =
  | 'COGS'
  | 'OPERATING'
  | 'PERSONAL'
  | 'INCOME'
  | 'TRANSFER'
  | 'REIMBURSABLE'
  | 'REIMBURSEMENT';

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

export function isIncomeForReporting(tx: TransferCheckInput): boolean {
  return tx.type === 'INCOME' && !isTransferLikeTransaction(tx);
}

export function getEffectiveClassification(
  tx: TransferCheckInput
): EffectiveClassification {
  const explicit = tx.classification as EffectiveClassification | null | undefined;
  if (explicit) return explicit;

  const fromCategory = tx.category?.defaultClassification as
    | EffectiveClassification
    | null
    | undefined;
  if (fromCategory) return fromCategory;

  if (tx.type === 'INCOME') return 'INCOME';
  if (tx.type === 'TRANSFER') return 'TRANSFER';
  return 'PERSONAL';
}
