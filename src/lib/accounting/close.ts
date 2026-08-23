import { createHash } from 'crypto';

export type CloseMetrics = {
  unknownCustodyAccounts: number;
  accountsWithoutConfirmedOwners: number;
  failedSourceEvents: number;
  duplicateSourceIdentities: number;
  unreconciledBankAccounts: number;
  partialProcessorSettlements: number;
  processorResidualCents: number;
  loanDifferenceCents: number;
  unattributedPersonalItems: number;
  materialEvidenceExceptions: number;
  suspenseBalanceCents: number;
  trialBalanceDifferenceCents: number;
};

export type CloseBlocker = {
  code: string;
  severity: 'BLOCKER';
  value: number;
  message: string;
};

const GATES: readonly [keyof CloseMetrics, string, string][] = [
  ['unknownCustodyAccounts', 'UNKNOWN_CUSTODY', 'Every active account needs a reviewed custody role.'],
  ['accountsWithoutConfirmedOwners', 'MISSING_ACCOUNT_OWNER', 'Every active account needs confirmed legal ownership.'],
  ['failedSourceEvents', 'FAILED_SOURCE_EVENTS', 'Failed source events must be resolved or formally excluded.'],
  ['duplicateSourceIdentities', 'DUPLICATE_SOURCE_IDENTITY', 'Canonical source identities must be unique.'],
  ['unreconciledBankAccounts', 'UNRECONCILED_BANK', 'Every bank/card/wallet account must reconcile.'],
  ['partialProcessorSettlements', 'PARTIAL_PROCESSOR_SETTLEMENT', 'Processor settlements must reconcile or be dated timing items.'],
  ['processorResidualCents', 'PROCESSOR_RESIDUAL', 'Processor clearing must have no unexplained residual.'],
  ['loanDifferenceCents', 'LOAN_DIFFERENCE', 'The lender roll-forward must match the lender statement.'],
  ['unattributedPersonalItems', 'UNATTRIBUTED_PERSONAL', 'Every personal-benefit item must identify its member.'],
  ['materialEvidenceExceptions', 'MATERIAL_EVIDENCE', 'Material postings must meet the evidence policy.'],
  ['suspenseBalanceCents', 'SUSPENSE_BALANCE', 'Material suspense must be cleared or formally approved.'],
  ['trialBalanceDifferenceCents', 'UNBALANCED_TRIAL_BALANCE', 'Trial balance debits and credits must agree.'],
];

export function evaluateCloseMetrics(metrics: CloseMetrics): CloseBlocker[] {
  return GATES.flatMap(([field, code, message]) => {
    const value = Math.abs(metrics[field]);
    return value === 0 ? [] : [{ code, severity: 'BLOCKER' as const, value, message }];
  });
}

export function closeSnapshotHash(input: {
  periodId: string;
  metrics: CloseMetrics;
  blockers: CloseBlocker[];
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ periodId: input.periodId, metrics: input.metrics, blockers: input.blockers }))
    .digest('hex');
}

export function prepareCloseSnapshot(periodId: string, metrics: CloseMetrics) {
  const blockers = evaluateCloseMetrics(metrics);
  return {
    periodId,
    metrics,
    blockers,
    status: blockers.length ? ('BLOCKED' as const) : ('READY' as const),
    snapshotHash: closeSnapshotHash({ periodId, metrics, blockers }),
  };
}
