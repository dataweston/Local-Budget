import { describe, expect, it } from 'vitest';
import { mapPlaidTransaction, mergePlaidTransactionMetadata } from '@/lib/plaid';

describe('Plaid transaction metadata preservation', () => {
  it('maps counterparty, payment, and original-description fields', () => {
    const mapped = mapPlaidTransaction({
      transaction_id: 'tx-1',
      account_id: 'account-1',
      amount: 42,
      date: '2026-07-01',
      name: 'Venmo',
      merchant_name: null,
      pending: false,
      original_description: 'VENMO PAYMENT 1234',
      counterparties: [{ name: 'Shared Kitchen LLC', type: 'merchant' }],
      payment_channel: 'other',
      payment_meta: { payee: 'Shared Kitchen LLC', reason: 'July kitchen rental' },
    });

    expect(mapped).toMatchObject({
      originalDescription: 'VENMO PAYMENT 1234',
      counterparties: [{ name: 'Shared Kitchen LLC', type: 'merchant' }],
      paymentMeta: { payee: 'Shared Kitchen LLC', reason: 'July kitchen rental' },
    });
  });

  it('merges Plaid facts without deleting existing statement or reconciliation metadata', () => {
    const metadata = mergePlaidTransactionMetadata(
      {
        transactionId: 'tx-1',
        accountId: 'account-1',
        amount: 42,
        date: '2026-07-01',
        name: 'Venmo',
        pending: false,
        counterparties: [{ name: 'Shared Kitchen LLC' }],
      },
      { venmoReconciliation: { statementId: 'statement-1' } },
      { transferDirection: 'out' }
    );

    expect(metadata).toMatchObject({
      venmoReconciliation: { statementId: 'statement-1' },
      transferDirection: 'out',
      plaidTransaction: { counterparties: [{ name: 'Shared Kitchen LLC' }] },
    });
  });
});
