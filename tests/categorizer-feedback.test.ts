import { describe, it, expect } from 'vitest';
import {
  suggestCategoryWithContext,
  normalizeMerchantKey,
  normalizeDescription,
  type SuggestionContext,
} from '@/lib/ml/categorizer';

function ctx(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return { references: [], rules: [], feedback: [], ...overrides };
}

describe('categorizer learned-feedback signal', () => {
  it('suggests the category the user previously chose for a merchant', () => {
    const merchantKey = normalizeMerchantKey('Eastside Food Cooperative')!;
    const out = suggestCategoryWithContext(
      ctx({
        feedback: [
          {
            merchantKey,
            descriptionKey: '',
            type: 'EXPENSE',
            categoryId: 'cat-cogs',
            categoryName: 'Food COGS',
            timesConfirmed: 1,
            wasCorrection: false,
          },
        ],
      }),
      'Eastside Food Cooperative',
      'Debit card purchase',
      'EXPENSE'
    );
    expect(out[0]).toMatchObject({ categoryId: 'cat-cogs', categoryName: 'Food COGS' });
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(out[0].reason).toMatch(/learned/i);
  });

  it('gains confidence with repeat confirmations', () => {
    const merchantKey = normalizeMerchantKey('Costco')!;
    const base = (times: number) =>
      suggestCategoryWithContext(
        ctx({
          feedback: [
            {
              merchantKey,
              descriptionKey: '',
              type: 'EXPENSE',
              categoryId: 'c1',
              categoryName: 'Supplies',
              timesConfirmed: times,
              wasCorrection: false,
            },
          ],
        }),
        'Costco',
        'purchase',
        'EXPENSE'
      )[0].confidence;
    expect(base(5)).toBeGreaterThan(base(1));
  });

  it('does not apply feedback across transaction types', () => {
    const merchantKey = normalizeMerchantKey('Square')!;
    const out = suggestCategoryWithContext(
      ctx({
        feedback: [
          {
            merchantKey,
            descriptionKey: '',
            type: 'EXPENSE',
            categoryId: 'c1',
            categoryName: 'Fees',
            timesConfirmed: 3,
            wasCorrection: false,
          },
        ],
      }),
      'Square',
      'payment',
      'INCOME'
    );
    expect(out).toHaveLength(0);
  });

  it('matches on description key when merchant is absent', () => {
    const descriptionKey = normalizeDescription('monthly rent payment');
    const out = suggestCategoryWithContext(
      ctx({
        feedback: [
          {
            merchantKey: '',
            descriptionKey,
            type: 'EXPENSE',
            categoryId: 'rent',
            categoryName: 'Rent',
            timesConfirmed: 1,
            wasCorrection: true,
          },
        ],
      }),
      null,
      'Monthly rent payment',
      'EXPENSE'
    );
    expect(out[0]?.categoryId).toBe('rent');
  });
});
