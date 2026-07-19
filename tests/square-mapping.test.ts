import { describe, it, expect } from 'vitest';
import {
  mapSquarePayment,
  mapSquareOrderLineItems,
  mapSquareOrderAdjustments,
} from '@/lib/square';

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

  it('captures tips: amount_money excludes the tip, total = base + tip', () => {
    const mapped = mapSquarePayment({
      ...base,
      tipMoney: { amount: 2000 },
      totalMoney: { amount: 14550 },
    });
    expect(mapped.amount).toBe(125.5);
    expect(mapped.tipAmount).toBe(20);
    expect(mapped.totalAmount).toBe(145.5);
  });

  it('derives total from base + tip when total_money is absent', () => {
    const mapped = mapSquarePayment({ ...base, tipMoney: { amount: 500 } });
    expect(mapped.totalAmount).toBe(130.5);
  });

  it('defaults tip to 0 and total to base for untipped payments', () => {
    const mapped = mapSquarePayment(base);
    expect(mapped.tipAmount).toBe(0);
    expect(mapped.totalAmount).toBe(125.5);
  });
});

describe('mapSquareOrderLineItems', () => {
  it('records item lines net of tax (total_money includes the tax share)', () => {
    const lines = mapSquareOrderLineItems({
      lineItems: [
        {
          uid: 'L1',
          name: 'Cardamom bun',
          quantity: '2',
          basePriceMoney: { amount: 500 },
          totalMoney: { amount: 1088 },
          totalTaxMoney: { amount: 88 },
        },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].totalPrice).toBe(10); // 10.88 - 0.88 tax
    expect(lines[0].unitPrice).toBe(5);
  });

  it('falls back to gross minus discounts when total_money is absent', () => {
    const lines = mapSquareOrderLineItems({
      lineItems: [
        {
          uid: 'L1',
          name: 'Loaf',
          quantity: '1',
          grossSalesMoney: { amount: 1200 },
          totalDiscountMoney: { amount: 200 },
        },
      ],
    });
    expect(lines[0].totalPrice).toBe(10);
  });
});

describe('mapSquareOrderAdjustments', () => {
  it('extracts tax, discount, and service charges as typed lines', () => {
    const adj = mapSquareOrderAdjustments({
      totalTaxMoney: { amount: 875 },
      totalDiscountMoney: { amount: 300 },
      serviceCharges: [{ uid: 'SC1', name: 'Delivery', totalMoney: { amount: 500 } }],
    });
    expect(adj).toEqual([
      { uid: 'order:tax', lineType: 'TAX', description: 'Sales tax collected', amount: 8.75 },
      { uid: 'order:discount', lineType: 'DISCOUNT', description: 'Order discounts', amount: 3 },
      { uid: 'sc:SC1', lineType: 'FEE', description: 'Service charge: Delivery', amount: 5 },
    ]);
  });

  it('returns nothing for orders with no tax/discount/charges (current state)', () => {
    expect(mapSquareOrderAdjustments({ totalTaxMoney: { amount: 0 } })).toEqual([]);
    expect(mapSquareOrderAdjustments({})).toEqual([]);
  });
});
