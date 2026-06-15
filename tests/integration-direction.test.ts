import { describe, it, expect } from 'vitest';
import { directionFor } from '@/app/api/integration/v1/transactions/route';

describe('directionFor', () => {
  it('treats vendor/expense classifications as outflow', () => {
    expect(directionFor('COGS')).toBe('outflow');
    expect(directionFor('OPERATING')).toBe('outflow');
    expect(directionFor('REIMBURSABLE')).toBe('outflow');
    expect(directionFor('PERSONAL')).toBe('outflow');
  });

  it('treats revenue classifications as inflow', () => {
    expect(directionFor('INCOME')).toBe('inflow');
    expect(directionFor('REIMBURSEMENT')).toBe('inflow');
  });

  it('keeps transfers out of the payment direction buckets', () => {
    // The brain's payment.completed feed pulls direction=outflow; a transfer
    // must never be exported as a vendor payment.
    expect(directionFor('TRANSFER')).toBe('transfer');
  });
});
