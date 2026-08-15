/**
 * Applies the pure transfer matcher (./matcher) to real data: pulls eligible
 * transactions across the owner's INTERNAL accounts, derives signed amounts,
 * pairs them, and (optionally) persists the result — marking matched legs as
 * TRANSFER + linking them, and tagging exceptions for review.
 *
 * Direction convention in this DB: `amount` is stored positive and direction
 * lives in `type` (EXPENSE = out, INCOME = in). A row already typed TRANSFER has
 * ambiguous direction unless metadata.transferDirection was recorded at ingest;
 * such rows are skipped (they're already excluded from P&L anyway). The high
 * value is pairing an INCOME leg with an EXPENSE leg and reclassifying BOTH as
 * internal transfers.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { recordFinancialAudit } from '@/lib/financial-integrity';
import {
  matchInternalTransfers,
  type TransferCandidate,
  type MatchOptions,
  type TransferMatch,
} from './matcher';

export type ReconcileOptions = MatchOptions & {
  apply?: boolean;
  /** Only consider transactions on/after this date. */
  since?: Date;
};

export type ReconcileSummary = {
  candidatesConsidered: number;
  pairsMatched: number;
  legsReclassified: number;
  ownerDraws: TransferMatch[]; // business -> personal
  ownerContributions: TransferMatch[]; // personal -> business
  unmatchedInflows: { id: string; amount: number; accountId: string; date: string }[];
  applied: boolean;
};

function signedAmount(type: string, amount: number, metadata: unknown): number | null {
  const abs = Math.abs(Number(amount));
  if (type === 'INCOME') return abs;
  if (type === 'EXPENSE') return -abs;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const direction = (metadata as Prisma.JsonObject).transferDirection;
  if (direction === 'in') return abs;
  if (direction === 'out') return -abs;
  return null;
}

export async function reconcileInternalTransfers(
  db: PrismaClient,
  userId: string,
  options: ReconcileOptions = {}
): Promise<ReconcileSummary> {
  const rows = await db.transaction.findMany({
    where: {
      account: { userId, isInternal: true },
      status: 'POSTED',
      ...(options.since ? { date: { gte: options.since } } : {}),
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      classification: true,
      date: true,
      metadata: true,
      account: { select: { entity: { select: { type: true } } } },
    },
  });

  const candidates: TransferCandidate[] = [];
  for (const r of rows) {
    const signed = signedAmount(r.type, Number(r.amount), r.metadata);
    if (signed === null) continue;
    candidates.push({
      id: r.id,
      accountId: r.accountId,
      entityType: r.account.entity?.type ?? null,
      signedAmount: signed,
      date: r.date,
      type: r.type,
      classification: r.classification,
    });
  }

  const result = matchInternalTransfers(candidates, options);

  const ownerDraws = result.matches.filter((m) => m.boundary === 'business_to_personal');
  const ownerContributions = result.matches.filter(
    (m) => m.boundary === 'personal_to_business'
  );

  let legsReclassified = 0;
  if (options.apply && result.matches.length > 0) {
    for (const match of result.matches) {
      const transferException =
        match.boundary === 'business_to_personal'
          ? 'owner_draw'
          : match.boundary === 'personal_to_business'
            ? 'owner_contribution'
            : null;

      await db.$transaction(async (tx) => {
        for (const leg of [
          { id: match.outflowId, direction: 'out' },
          { id: match.inflowId, direction: 'in' },
        ] as const) {
          const existing = await tx.transaction.findUniqueOrThrow({
            where: { id: leg.id },
            select: {
              type: true,
              classification: true,
              metadata: true,
            },
          });
          const priorMetadata =
            existing.metadata &&
            typeof existing.metadata === 'object' &&
            !Array.isArray(existing.metadata)
              ? existing.metadata
              : {};
          const metadata = {
            ...priorMetadata,
            transferDirection: leg.direction,
            ...(transferException ? { transferException } : {}),
          };
          await tx.transaction.update({
            where: { id: leg.id },
            data: {
              type: 'TRANSFER',
              classification: 'TRANSFER',
              metadata,
            },
          });
          await recordFinancialAudit(tx, {
            userId,
            transactionId: leg.id,
            action: 'TRANSFER_RECONCILED',
            source: 'AUTO',
            reason: transferException ?? 'Auto-paired internal transfer',
            changedFields: ['type', 'classification', 'metadata', 'transactionLink'],
            before: {
              type: existing.type,
              classification: existing.classification,
              metadata: existing.metadata,
            },
            after: {
              type: 'TRANSFER',
              classification: 'TRANSFER',
              metadata,
            },
          });
        }

        await tx.transactionLink.upsert({
          where: {
            fromId_toId_linkType: {
              fromId: match.outflowId,
              toId: match.inflowId,
              linkType: 'TRANSFER',
            },
          },
          create: {
            fromId: match.outflowId,
            toId: match.inflowId,
            linkType: 'TRANSFER',
            notes: match.crossesBoundary
              ? `Boundary: ${match.boundary}`
              : 'Auto-paired internal transfer',
          },
          update: {},
        });
      });
      legsReclassified += 2;
    }
  }

  return {
    candidatesConsidered: candidates.length,
    pairsMatched: result.matches.length,
    legsReclassified,
    ownerDraws,
    ownerContributions,
    unmatchedInflows: result.unmatchedInflows.map((c) => ({
      id: c.id,
      amount: Math.abs(c.signedAmount),
      accountId: c.accountId,
      date: c.date.toISOString(),
    })),
    applied: !!options.apply,
  };
}
