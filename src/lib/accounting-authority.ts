/**
 * Owner-confirmed legal/custody facts used to seed the accounting migration.
 *
 * This module deliberately does not mutate accounts or classify transactions.
 * A rule identifies legal custody; economic ownership remains a separate field
 * because Local Effort revenue and costs can pass through a founder-owned
 * account without becoming the founder's revenue or expense.
 */

export const ACCOUNTING_AUTHORITY_VERSION = '2026-09-03.v2' as const;

export type AuthorityActor = 'WESTON' | 'CATHERINE' | 'LOCAL_EFFORT';

export type AuthorityCustodyRole = 'BUSINESS' | 'PERSONAL' | 'PROCESSOR' | 'SHARED';

export type AccountAuthorityRule = {
  canonicalAccountKey: string;
  accountNames: readonly string[];
  legalOwners: readonly AuthorityActor[];
  custodyRole: AuthorityCustodyRole;
  economicScope: 'REVIEW_REQUIRED' | 'LOCAL_EFFORT';
  note: string;
};

export const ACCOUNT_AUTHORITY_RULES: readonly AccountAuthorityRule[] = [
  {
    canonicalAccountKey: 'square-processor-weston',
    accountNames: ['Square'],
    legalOwners: ['WESTON'],
    custodyRole: 'PROCESSOR',
    economicScope: 'LOCAL_EFFORT',
    note:
      'Square is the Weston-held processor ledger for Local Effort activity. It records gross processor facts, not bank cash.',
  },
  {
    canonicalAccountKey: 'stripe-processor-weston',
    accountNames: ['Stripe'],
    legalOwners: ['WESTON'],
    custodyRole: 'PROCESSOR',
    economicScope: 'REVIEW_REQUIRED',
    note:
      'Owner confirms Stripe account acct_1NxcXbAMgX7ghwAp belongs to Weston. ' +
      'Preserve processor facts while attributing each receipt to revenue, personal financing, or another economic owner from source evidence.',
  },
  {
    canonicalAccountKey: 'local-pizza-bank-weston',
    accountNames: ['Local Pizza'],
    legalOwners: ['WESTON'],
    custodyRole: 'BUSINESS',
    economicScope: 'LOCAL_EFFORT',
    note:
      'Owner confirms Local Pizza has the same Weston custody/business scope as Square. ' +
      'It remains a distinct Plaid bank ledger linked to Square by payouts; net bank deposits must not become a second sales stream.',
  },
  {
    canonicalAccountKey: 'sofi-checking-shared',
    accountNames: ['SoFi Checking'],
    legalOwners: ['WESTON', 'CATHERINE'],
    custodyRole: 'SHARED',
    economicScope: 'REVIEW_REQUIRED',
    note: 'Joint Weston/Catherine custody; each business-purpose transaction still needs an economic owner.',
  },
  {
    canonicalAccountKey: 'total-checking-catherine',
    accountNames: ['TOTAL CHECKING'],
    legalOwners: ['CATHERINE'],
    custodyRole: 'PERSONAL',
    economicScope: 'REVIEW_REQUIRED',
    note: 'Catherine-owned account that may contain personal or business-custody activity.',
  },
  {
    canonicalAccountKey: 'general-savings-weston',
    accountNames: ['General savings'],
    legalOwners: ['WESTON'],
    custodyRole: 'PERSONAL',
    economicScope: 'REVIEW_REQUIRED',
    note: 'Weston-owned account that may contain personal or business-custody activity.',
  },
  {
    canonicalAccountKey: 'sofi-savings-shared',
    accountNames: ['SoFi Savings'],
    legalOwners: ['WESTON', 'CATHERINE'],
    custodyRole: 'SHARED',
    economicScope: 'REVIEW_REQUIRED',
    note: 'Joint Weston/Catherine custody; do not infer business purpose from the account alone.',
  },
  {
    canonicalAccountKey: 'venmo-catherine',
    accountNames: ['Venmo Wallet'],
    legalOwners: ['CATHERINE'],
    custodyRole: 'PERSONAL',
    economicScope: 'REVIEW_REQUIRED',
    note: 'Catherine-owned wallet; Local Effort receipts create business cash held in Catherine custody.',
  },
] as const;

export const LOCAL_EFFORT_FORMATION = {
  legalName: 'Local Effort',
  jurisdiction: 'Minnesota',
  statuteChapter: '308B',
  filedAt: '2026-04-21T23:59:00-05:00',
  fileNumber: '1644146400023',
  documentSha256: '84DE497655753C163497ACF2E332C7A460904A0B6750FD5D2E43989ABE8FE35B',
  evidenceLabel: 'Original Filing - Cooperative Association.pdf.pdf',
  conclusion:
    'This establishes the Minnesota 308B formation/registration event. It does not by itself determine the tax or accounting continuity of predecessor activity.',
} as const;

function normalizeAccountName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function findAccountAuthority(name: string): AccountAuthorityRule | null {
  const normalized = normalizeAccountName(name);
  return (
    ACCOUNT_AUTHORITY_RULES.find((rule) =>
      rule.accountNames.some((candidate) => normalizeAccountName(candidate) === normalized)
    ) ?? null
  );
}

export function listAccountAuthorityNames(): string[] {
  return ACCOUNT_AUTHORITY_RULES.flatMap((rule) => [...rule.accountNames]);
}
