/**
 * Read-only review of current account names against owner-confirmed custody.
 *
 * Emits no balances, account numbers, provider payloads, or transaction text.
 * It does not change Entity or FinancialAccount records.
 */

import './load-env';
import { PrismaClient } from '@prisma/client';
import {
  ACCOUNTING_AUTHORITY_VERSION,
  ACCOUNT_AUTHORITY_RULES,
  LOCAL_EFFORT_FORMATION,
  findAccountAuthority,
} from '../src/lib/accounting-authority';

const db = new PrismaClient();

async function main() {
  const accounts = await db.financialAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      institution: true,
      entity: { select: { name: true, type: true } },
      squareConnectionId: true,
      plaidAccountId: true,
    },
    orderBy: { name: 'asc' },
  });

  const reviewed = accounts.map((account) => {
    const authority = findAccountAuthority(account.name);
    return {
      accountName: account.name,
      institution: account.institution,
      currentEntity: account.entity?.name ?? null,
      currentEntityType: account.entity?.type ?? null,
      hasSquareConnection: Boolean(account.squareConnectionId),
      hasPlaidIdentity: Boolean(account.plaidAccountId),
      authorityStatus: authority ? 'OWNER_CONFIRMED' : 'UNMAPPED',
      canonicalAccountKey: authority?.canonicalAccountKey ?? null,
      legalOwners: authority?.legalOwners ?? [],
      custodyRole: authority?.custodyRole ?? null,
      economicScope: authority?.economicScope ?? 'REVIEW_REQUIRED',
    };
  });

  const canonicalCounts = reviewed.reduce<Record<string, number>>((out, account) => {
    if (account.canonicalAccountKey) {
      out[account.canonicalAccountKey] = (out[account.canonicalAccountKey] ?? 0) + 1;
    }
    return out;
  }, {});

  console.log(
    JSON.stringify(
      {
        asOf: new Date().toISOString(),
        authorityVersion: ACCOUNTING_AUTHORITY_VERSION,
        formation: LOCAL_EFFORT_FORMATION,
        expectedRules: ACCOUNT_AUTHORITY_RULES.length,
        activeAccounts: reviewed.length,
        mappedAccounts: reviewed.filter((account) => account.authorityStatus === 'OWNER_CONFIRMED')
          .length,
        unmappedAccounts: reviewed
          .filter((account) => account.authorityStatus === 'UNMAPPED')
          .map((account) => account.accountName),
        duplicateCanonicalRepresentations: Object.entries(canonicalCounts)
          .filter(([, count]) => count > 1)
          .map(([canonicalAccountKey, count]) => ({ canonicalAccountKey, count })),
        accounts: reviewed,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('Account-authority audit failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
