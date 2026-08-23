import { describe, expect, it } from 'vitest';
import { prepareCloseSnapshot, type CloseMetrics } from '@/lib/accounting/close';

const clean: CloseMetrics = {
  unknownCustodyAccounts: 0,
  accountsWithoutConfirmedOwners: 0,
  failedSourceEvents: 0,
  duplicateSourceIdentities: 0,
  unreconciledBankAccounts: 0,
  partialProcessorSettlements: 0,
  processorResidualCents: 0,
  loanDifferenceCents: 0,
  unattributedPersonalItems: 0,
  materialEvidenceExceptions: 0,
  suspenseBalanceCents: 0,
  trialBalanceDifferenceCents: 0,
};

describe('accounting close gates', () => {
  it('marks a fully reconciled period ready with a reproducible hash', () => {
    const first = prepareCloseSnapshot('2026-08', clean);
    const second = prepareCloseSnapshot('2026-08', clean);
    expect(first.status).toBe('READY');
    expect(first.blockers).toEqual([]);
    expect(first.snapshotHash).toBe(second.snapshotHash);
  });

  it('blocks close on custody, processor, personal, evidence, or balance failures', () => {
    const result = prepareCloseSnapshot('2026-08', {
      ...clean,
      unknownCustodyAccounts: 1,
      processorResidualCents: -125,
      unattributedPersonalItems: 2,
      materialEvidenceExceptions: 3,
      trialBalanceDifferenceCents: 1,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'UNKNOWN_CUSTODY',
      'PROCESSOR_RESIDUAL',
      'UNATTRIBUTED_PERSONAL',
      'MATERIAL_EVIDENCE',
      'UNBALANCED_TRIAL_BALANCE',
    ]);
  });
});
