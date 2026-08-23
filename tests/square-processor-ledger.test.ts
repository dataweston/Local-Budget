import { describe, expect, it } from 'vitest';
import {
  isSquareDestinationBankAccount,
  selectSquareProcessorLedgerAccount,
} from '@/lib/square-processor-ledger';

describe('Square processor-ledger selection', () => {
  it('selects the tagged processor ledger, never an attached destination bank', () => {
    const destination = { id: 'bank-destination', providerData: { provider: 'square_bank' } };
    const ledger = { id: 'square-ledger', providerData: { provider: 'square' } };

    const selection = selectSquareProcessorLedgerAccount([destination, ledger]);

    expect(isSquareDestinationBankAccount(destination)).toBe(true);
    expect(selection).toEqual({ account: ledger, reason: 'tagged' });
  });

  it('keeps a single legacy connection compatible without letting a bank placeholder qualify', () => {
    const legacy = { id: 'legacy', providerData: null };
    expect(selectSquareProcessorLedgerAccount([legacy])).toEqual({
      account: legacy,
      reason: 'single-legacy',
    });
    expect(
      selectSquareProcessorLedgerAccount([
        { id: 'bank-destination', providerData: { provider: 'square_bank' } },
      ])
    ).toEqual({ account: undefined, reason: 'missing' });
  });

  it('fails closed instead of selecting different accounts for polling and webhooks', () => {
    const accounts = [
      { id: 'old-a', providerData: null },
      { id: 'old-b', providerData: null },
    ];

    // Both paths call this shared selector. Choosing either row here would make
    // their per-account external-id idempotency constraint ineffective.
    expect(selectSquareProcessorLedgerAccount(accounts)).toEqual({
      account: undefined,
      reason: 'ambiguous-legacy',
    });
  });

  it('flags multiple tagged processor ledgers for repair rather than guessing', () => {
    expect(
      selectSquareProcessorLedgerAccount([
        { id: 'ledger-a', providerData: { provider: 'square' } },
        { id: 'ledger-b', providerData: { provider: 'square' } },
      ])
    ).toEqual({ account: undefined, reason: 'ambiguous-tagged' });
  });
});
