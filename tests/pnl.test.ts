import { describe, it, expect } from 'vitest';
import { getEffectiveClassification } from '@/lib/pnl';

describe('getEffectiveClassification', () => {
  it('prefers the explicit transaction classification', () => {
    expect(
      getEffectiveClassification({
        classification: 'COGS',
        type: 'EXPENSE',
        category: { defaultClassification: 'OPERATING' },
      })
    ).toBe('COGS');
  });

  it('falls back to the category default', () => {
    expect(
      getEffectiveClassification({
        classification: null,
        type: 'EXPENSE',
        category: { defaultClassification: 'OPERATING' },
      })
    ).toBe('OPERATING');
  });

  it('falls back to the transaction type for income and transfers', () => {
    expect(getEffectiveClassification({ type: 'INCOME' })).toBe('INCOME');
    expect(getEffectiveClassification({ type: 'TRANSFER' })).toBe('TRANSFER');
  });

  it('defaults to PERSONAL for unclassified expenses', () => {
    expect(getEffectiveClassification({ type: 'EXPENSE' })).toBe('PERSONAL');
    expect(getEffectiveClassification({})).toBe('PERSONAL');
  });
});
