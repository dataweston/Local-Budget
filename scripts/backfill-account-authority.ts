/**
 * Review/apply owner-confirmed account custody after the accounting-core
 * migration is deployed.
 *
 * Dry-run (default): pnpm accounting:authority
 * Apply:             pnpm accounting:authority:apply
 *
 * Applying is additive: it creates Weston/Catherine entities when absent,
 * upserts effective account-owner links, and sets custodyRole. It does not
 * reclassify transactions, merge Square/Local Pizza, or delete old entities.
 */

import './load-env';
import { AccountOwnershipRole, CustodyRole, Prisma, PrismaClient } from '@prisma/client';
import {
  ACCOUNTING_AUTHORITY_VERSION,
  findAccountAuthority,
} from '../src/lib/accounting-authority';

const db = new PrismaClient();
const apply = process.argv.includes('--apply');
const confirmedAt = new Date('2026-08-23T00:00:00-05:00');

const ACTORS = {
  WESTON: { name: 'Weston Smith', type: 'PERSON' as const },
  CATHERINE: { name: 'Catherine Olsen', type: 'PERSON' as const },
  LOCAL_EFFORT: { name: 'Local Effort', type: 'BUSINESS' as const },
};

async function findOrCreateActor(
  tx: Prisma.TransactionClient,
  userId: string,
  actor: keyof typeof ACTORS
) {
  const definition = ACTORS[actor];
  const existing = await tx.entity.findFirst({
    where: { userId, name: definition.name, type: definition.type },
  });
  if (existing) return existing;
  return tx.entity.create({
    data: {
      userId,
      name: definition.name,
      type: definition.type,
      description: `Created from owner-confirmed account authority ${ACCOUNTING_AUTHORITY_VERSION}`,
    },
  });
}

async function main() {
  const accounts = await db.financialAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      userId: true,
      name: true,
      custodyRole: true,
      accountOwnerships: {
        select: {
          entityId: true,
          role: true,
          effectiveTo: true,
          entity: { select: { name: true } },
        },
      },
    },
    orderBy: [{ userId: 'asc' }, { name: 'asc' }],
  });
  const plan = accounts.map((account) => {
    const rule = findAccountAuthority(account.name);
    return {
      accountId: account.id,
      userId: account.userId,
      accountName: account.name,
      currentCustodyRole: account.custodyRole,
      targetCustodyRole: (rule?.custodyRole ?? 'UNKNOWN') as CustodyRole,
      legalOwners: rule?.legalOwners ?? [],
      ownershipRole:
        rule && rule.legalOwners.length > 1
          ? AccountOwnershipRole.JOINT_OWNER
          : AccountOwnershipRole.SOLE_OWNER,
      mapped: Boolean(rule),
      unexpectedActiveOwnerships: account.accountOwnerships
        .filter(
          (ownership) =>
            (!ownership.effectiveTo || ownership.effectiveTo > confirmedAt) &&
            (!rule ||
              !rule.legalOwners.some(
                (actor) => ACTORS[actor].name === ownership.entity.name
              ) ||
              ownership.role !==
                (rule.legalOwners.length > 1
                  ? AccountOwnershipRole.JOINT_OWNER
                  : AccountOwnershipRole.SOLE_OWNER))
        )
        .map((ownership) => ({
          entityId: ownership.entityId,
          entityName: ownership.entity.name,
          role: ownership.role,
        })),
    };
  });

  if (!apply) {
    console.log(JSON.stringify({ apply: false, authorityVersion: ACCOUNTING_AUTHORITY_VERSION, plan }, null, 2));
    return;
  }

  const unmapped = plan.filter((row) => !row.mapped);
  if (unmapped.length) {
    throw new Error(`Refusing apply: ${unmapped.length} active account(s) are not owner-confirmed`);
  }
  const canonicalCounts = new Map<string, number>();
  for (const row of plan) {
    const key = findAccountAuthority(row.accountName)?.canonicalAccountKey;
    if (key) canonicalCounts.set(key, (canonicalCounts.get(key) ?? 0) + 1);
  }
  const duplicateRepresentations = Array.from(canonicalCounts.entries()).filter(
    ([, count]) => count > 1
  );
  if (duplicateRepresentations.length) {
    throw new Error(
      `Refusing apply: duplicate canonical account representations: ${duplicateRepresentations
        .map(([key, count]) => `${key} (${count})`)
        .join(', ')}`
    );
  }
  const ownershipConflicts = plan.filter((row) => row.unexpectedActiveOwnerships.length > 0);
  if (ownershipConflicts.length) {
    throw new Error(
      `Refusing apply: ${ownershipConflicts.length} account(s) have conflicting active ownership records`
    );
  }

  const result = await db.$transaction(async (tx) => {
    let accountsUpdated = 0;
    let ownershipsUpserted = 0;
    for (const row of plan) {
      let changed = row.currentCustodyRole !== row.targetCustodyRole;
      const owners = await Promise.all(
        row.legalOwners.map((actor) => findOrCreateActor(tx, row.userId, actor))
      );
      if (row.currentCustodyRole !== row.targetCustodyRole) {
        await tx.financialAccount.update({
          where: { id: row.accountId },
          data: { custodyRole: row.targetCustodyRole },
        });
        accountsUpdated++;
      }
      for (const owner of owners) {
        const key = {
          accountId: row.accountId,
          entityId: owner.id,
          role: row.ownershipRole,
        };
        const existing = await tx.financialAccountOwner.findUnique({
          where: { accountId_entityId_role: key },
        });
        if (
          !existing ||
          existing.confirmedAt?.getTime() !== confirmedAt.getTime() ||
          existing.sourceRef !== ACCOUNTING_AUTHORITY_VERSION ||
          existing.effectiveTo
        ) {
          await tx.financialAccountOwner.upsert({
            where: { accountId_entityId_role: key },
            update: {
              confirmedAt,
              sourceRef: ACCOUNTING_AUTHORITY_VERSION,
              effectiveTo: null,
            },
            create: {
              ...key,
              confirmedAt,
              sourceRef: ACCOUNTING_AUTHORITY_VERSION,
            },
          });
          changed = true;
          ownershipsUpserted++;
        }
      }
      if (changed) {
        await tx.financialAuditEvent.create({
          data: {
            userId: row.userId,
            financialAccountId: row.accountId,
            action: 'ACCOUNT_AUTHORITY_CONFIRMED',
            source: 'OWNER_CONFIRMED',
            reason: ACCOUNTING_AUTHORITY_VERSION,
            changedFields: ['custodyRole', 'accountOwnerships'],
            before: { custodyRole: row.currentCustodyRole },
            after: {
              custodyRole: row.targetCustodyRole,
              legalOwners: row.legalOwners,
              ownershipRole: row.ownershipRole,
            },
          },
        });
      }
    }
    return { accountsUpdated, ownershipsUpserted };
  });

  console.log(JSON.stringify({ apply: true, authorityVersion: ACCOUNTING_AUTHORITY_VERSION, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error('Account-authority backfill failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
