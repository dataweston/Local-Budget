export type VenmoStatementDetails = {
  statementId?: string;
  statementDateTime?: string;
  type?: string;
  status?: string;
  note?: string;
  from?: string;
  to?: string;
  amountTotalSigned?: number;
  amountFeeSigned?: number;
  fundingSource?: string;
  destination?: string;
  sourceFile?: string;
  confidence?: string;
  matchSource?: string;
  dayDiff?: number | null;
  amountDiff?: number | null;
  candidateCount?: number;
  matchedBankTransactionId?: string;
  canonicalTransactionId?: string;
  reconciliationReason?: string;
  plaidCounterparty?: string;
  plaidPayer?: string;
  plaidPayee?: string;
  plaidMemo?: string;
  plaidOriginalDescription?: string;
  hasStatementData: boolean;
  hasPlaidDetail: boolean;
  hasBankLink: boolean;
  isCanonical: boolean;
  dataSource: 'statement' | 'plaid' | 'bank-only';
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Read both generations of Venmo metadata:
 * - venmoStatementMatch: statement details attached to a pre-existing bank row
 * - venmoStatementEntry: canonical Venmo Wallet row created by the sync command
 *
 * The UI previously read only the legacy key, which made canonical rows appear
 * no richer than their bank descriptions even though the statement facts were
 * present in the database.
 */
export function parseVenmoStatementDetails(metadata: unknown): VenmoStatementDetails {
  const root = record(metadata);
  const canonical = record(root?.venmoStatementEntry);
  const legacyMatch = record(root?.venmoStatementMatch);
  const reconciliation = record(root?.venmoReconciliation);
  const plaidTransaction = record(root?.plaidTransaction);
  const paymentMeta = record(plaidTransaction?.paymentMeta);
  const counterparties = Array.isArray(plaidTransaction?.counterparties)
    ? plaidTransaction.counterparties.map(record).filter(Boolean)
    : [];
  const statement = canonical || legacyMatch ? { ...canonical, ...legacyMatch } : null;

  const matchedBankTransactionId = stringValue(reconciliation?.matchedBankTransactionId);
  const canonicalTransactionId = stringValue(reconciliation?.canonicalTransactionId);
  const plaidCounterparty = counterparties
    .map((counterparty) => stringValue(counterparty?.name))
    .find((name) => name && !/^venmo(?:\s|$)/i.test(name));
  const plaidPayer = stringValue(paymentMeta?.payer);
  const plaidPayee = stringValue(paymentMeta?.payee);
  const plaidMemo = stringValue(paymentMeta?.reason);
  const plaidOriginalDescription = stringValue(plaidTransaction?.originalDescription);
  const hasStatementData = !!statement;
  const hasPlaidDetail = !!(
    plaidCounterparty ||
    plaidMemo ||
    plaidPayer ||
    plaidPayee ||
    plaidOriginalDescription
  );

  return {
    statementId: stringValue(statement?.statementId) || stringValue(reconciliation?.statementId),
    statementDateTime: stringValue(statement?.statementDateTime),
    type: stringValue(statement?.type),
    status: stringValue(statement?.status),
    note: stringValue(statement?.note),
    from: stringValue(statement?.from),
    to: stringValue(statement?.to),
    amountTotalSigned: numberValue(statement?.amountTotalSigned),
    amountFeeSigned: numberValue(statement?.amountFeeSigned),
    fundingSource: stringValue(statement?.fundingSource),
    destination: stringValue(statement?.destination),
    sourceFile: stringValue(statement?.sourceFile),
    confidence: stringValue(statement?.confidence),
    matchSource: stringValue(statement?.matchSource),
    dayDiff: numberValue(statement?.dayDiff) ?? numberValue(reconciliation?.dayDiff) ?? null,
    amountDiff:
      numberValue(statement?.amountDiff) ?? numberValue(reconciliation?.amountDiff) ?? null,
    candidateCount: numberValue(statement?.candidateCount),
    matchedBankTransactionId,
    canonicalTransactionId,
    reconciliationReason: stringValue(reconciliation?.reason),
    plaidCounterparty,
    plaidPayer,
    plaidPayee,
    plaidMemo,
    plaidOriginalDescription,
    hasStatementData,
    hasPlaidDetail,
    hasBankLink: !!legacyMatch || !!matchedBankTransactionId || !!canonicalTransactionId,
    isCanonical: !!canonical,
    dataSource: hasStatementData ? 'statement' : hasPlaidDetail ? 'plaid' : 'bank-only',
  };
}

export function getVenmoCounterparty(
  details: Pick<
    VenmoStatementDetails,
    'from' | 'to' | 'plaidCounterparty' | 'plaidPayer' | 'plaidPayee'
  >,
  transactionType: string
): string | undefined {
  return transactionType === 'INCOME'
    ? details.from ||
        details.to ||
        details.plaidPayer ||
        details.plaidCounterparty ||
        details.plaidPayee
    : details.to ||
        details.from ||
        details.plaidPayee ||
        details.plaidCounterparty ||
        details.plaidPayer;
}

export function getVenmoMemo(details: VenmoStatementDetails): string | undefined {
  return details.note || details.plaidMemo;
}
