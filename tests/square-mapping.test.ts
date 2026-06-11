import { describe, it, expect } from 'vitest';
import { mapSquarePayment } from '@/lib/square';

describe('mapSquarePayment', () => {
  const base = {
    id: 'PAYMENT123456',
    amountMoney: { amount: 12550, currency: 'USD' },
    createdAt: '2026-06-01T12:00:00Z',
    status: 'COMPLETED',
  };

  it('converts cents to dollars', () => {
    expect(mapSquarePayment(base).amount).toBe(125.5);
  });

  it('prefers the seller note for the description', () => {
    expect(mapSquarePayment({ ...base, note: 'June catering deposit' }).description).toBe(
      'June catering deposit'
    );
  });

  it('falls back to the buyer email (invoice / payment-link payments)', () => {
    const mapped = mapSquarePayment({ ...base, buyerEmailAddress: 'client@x.test' });
    expect(mapped.description).toBe('Square payment from client@x.test');
    expect(mapped.buyerEmail).toBe('client@x.test');
  });

  it('falls back to the receipt number, then the id suffix', () => {
    expect(mapSquarePayment({ ...base, receiptNumber: 'R-778' }).description).toBe(
      'Square Payment R-778'
    );
    expect(mapSquarePayment(base).description).toBe('Square Payment 123456');
  });

  it('keeps order/customer linkage for channel detection', () => {
    const mapped = mapSquarePayment({ ...base, orderId: 'ORD9', customerId: 'CUST1' });
    expect(mapped.orderId).toBe('ORD9');
    expect(mapped.customerId).toBe('CUST1');
  });
});
