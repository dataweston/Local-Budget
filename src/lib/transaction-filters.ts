type TransferCheckInput = {
  type?: string | null;
  classification?: string | null;
  category?: {
    defaultClassification?: string | null;
  } | null;
};

/**
 * `UNCLASSIFIED` is a derived-only value — it is never stored on a transaction
 * (the DB enum has no such member). It means "nobody has decided yet", and it
 * exists so that an undecided expense is reported as undecided instead of being
 * silently attributed to the owner's personal spending.
 */
export type EffectiveClassification =
  | 'COGS'
  | 'OPERATING'
  | 'PERSONAL'
  | 'INCOME'
  | 'TRANSFER'
  | 'REIMBURSABLE'
  | 'REIMBURSEMENT'
  | 'UNCLASSIFIED';

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

  // An expense nobody has classified is NOT personal spending. Defaulting it to
  // PERSONAL used to hide it from the business P&L entirely (personal is
  // excluded from operating income), which flattered operating income by
  // whatever happened to be un-triaged. Report it as undecided instead.
  return 'UNCLASSIFIED';
}
