import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_AUTHORITY_RULES,
  LOCAL_EFFORT_FORMATION,
  findAccountAuthority,
  listAccountAuthorityNames,
} from '@/lib/accounting-authority';

describe('owner-confirmed accounting authority', () => {
  it('maps every named current account exactly once', () => {
    const names = listAccountAuthorityNames().map((name) => name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(findAccountAuthority(`  ${name.toUpperCase()}  `)).not.toBeNull();
    }
  });

  it('keeps legal custody separate from economic ownership', () => {
    const square = findAccountAuthority('Square');
    const localPizza = findAccountAuthority('Local Pizza');
    const venmo = findAccountAuthority('Venmo Wallet');
    const stripe = findAccountAuthority('Stripe');

    expect(square?.canonicalAccountKey).toBe('square-processor-weston');
    expect(localPizza?.canonicalAccountKey).toBe('local-pizza-bank-weston');
    expect(square?.legalOwners).toEqual(['WESTON']);
    expect(localPizza?.legalOwners).toEqual(square?.legalOwners);
    expect(stripe?.canonicalAccountKey).toBe('stripe-processor-weston');
    expect(stripe?.legalOwners).toEqual(['WESTON']);
    expect(stripe?.economicScope).toBe('REVIEW_REQUIRED');
    expect(square?.economicScope).toBe('LOCAL_EFFORT');
    expect(localPizza?.economicScope).toBe('LOCAL_EFFORT');
    expect(venmo?.legalOwners).toEqual(['CATHERINE']);
    expect(venmo?.economicScope).toBe('REVIEW_REQUIRED');
  });

  it('records the filed Minnesota 308B formation event without deciding predecessor continuity', () => {
    expect(LOCAL_EFFORT_FORMATION.statuteChapter).toBe('308B');
    expect(LOCAL_EFFORT_FORMATION.fileNumber).toBe('1644146400023');
    expect(LOCAL_EFFORT_FORMATION.filedAt.startsWith('2026-04-21')).toBe(true);
    expect(LOCAL_EFFORT_FORMATION.documentSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(LOCAL_EFFORT_FORMATION.conclusion).toContain('does not by itself determine');
  });

  it('requires review for all mixed or personal custody accounts', () => {
    const reviewRules = ACCOUNT_AUTHORITY_RULES.filter(
      (rule) => rule.economicScope === 'REVIEW_REQUIRED'
    );
    expect(reviewRules.length).toBe(6);
  });
});
