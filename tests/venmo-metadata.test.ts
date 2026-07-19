import { describe, expect, it } from 'vitest';
import { getVenmoCounterparty, parseVenmoStatementDetails } from '@/lib/venmo-metadata';

describe('parseVenmoStatementDetails', () => {
  it('reads canonical Venmo Wallet metadata and its bank reconciliation', () => {
    const details = parseVenmoStatementDetails({
      venmoStatementEntry: {
        statementId: '123',
        note: 'July kitchen rental',
        from: 'Local Effort',
        to: 'Shared Kitchen',
        fundingSource: 'Venmo balance',
        destination: 'Shared Kitchen',
      },
      venmoReconciliation: { matchedBankTransactionId: 'bank-1', reason: 'expense-duplicate' },
    });

    expect(details).toMatchObject({
      statementId: '123',
      note: 'July kitchen rental',
      fundingSource: 'Venmo balance',
      hasStatementData: true,
      hasBankLink: true,
      isCanonical: true,
    });
    expect(getVenmoCounterparty(details, 'EXPENSE')).toBe('Shared Kitchen');
  });

  it('continues to read legacy cross-reference metadata', () => {
    const details = parseVenmoStatementDetails({
      venmoStatementMatch: {
        statementId: '456',
        from: 'Customer',
        to: 'Local Effort',
        confidence: 'high',
      },
    });

    expect(details.hasStatementData).toBe(true);
    expect(details.hasBankLink).toBe(true);
    expect(details.isCanonical).toBe(false);
    expect(getVenmoCounterparty(details, 'INCOME')).toBe('Customer');
  });

  it('returns explicit empty-state flags for unrelated metadata', () => {
    expect(parseVenmoStatementDetails({ plaid: true })).toMatchObject({
      hasStatementData: false,
      hasBankLink: false,
      isCanonical: false,
    });
  });
});
