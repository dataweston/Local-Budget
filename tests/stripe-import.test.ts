import { describe, expect, it } from 'vitest';
import { parseStripeBalanceCsv, StripeImportError } from '@/lib/accounting/stripe-import';

describe('Stripe balance-history import', () => {
  it('preserves processor grain and validates gross-to-net arithmetic', () => {
    const csv = [
      'id,Created (UTC),Available On (UTC),Currency,Gross,Fee,Net,Reporting Category,Source,Description',
      'txn_1,2023-05-01T12:00:00Z,2023-05-03T00:00:00Z,usd,100.00,-3.20,96.80,charge,ch_1,"Customer, order"',
    ].join('\n');
    const [row] = parseStripeBalanceCsv(csv);
    expect(row).toMatchObject({
      externalId: 'txn_1',
      currency: 'USD',
      grossCents: 10000,
      feeCents: -320,
      netCents: 9680,
      arithmeticOk: true,
      sourceId: 'ch_1',
    });
    expect(row.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects customer aggregates that are not a balance ledger', () => {
    const customerAggregate = 'customer_id,email,total_spend,payment_count\ncus_1,a@example.com,100,2';
    expect(() => parseStripeBalanceCsv(customerAggregate)).toThrow(StripeImportError);
  });

  it('rejects duplicate balance transaction identities in one file', () => {
    const csv = [
      'id,Created,Currency,Gross,Fee,Net',
      'txn_1,2023-05-01T12:00:00Z,usd,10,-1,9',
      'txn_1,2023-05-02T12:00:00Z,usd,10,-1,9',
    ].join('\n');
    expect(() => parseStripeBalanceCsv(csv)).toThrow('duplicate Stripe id');
  });
});
