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
import type { PrismaClient } from '@prisma/client';
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

function signedAmount(type: string, amount: number, metadata: any): number | null {
  const abs = Math.abs(Number(amount));
  if (type === 'INCOME') return abs;
  if (type === 'EXPENSE') return -abs;
  // TRANSFER: recover direction from metadata if present, else skip (ambiguous).
  const dir = metadata?.transferDirection;
  if (dir === 'in') return abs;
  if (dir === 'out') return -abs;
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
    for (const m of result.matches) {
      // Mark both legs as internal transfers (excluded from P&L) and link them.
      await db.transaction.updateMany({
        where: { id: { in: [m.outflowId, m.inflowId] } },
        data: { type: 'TRANSFER', classification: 'TRANSFER' },
      });
      legsReclassified += 2;

      await db.transactionLink.upsert({
        where: {
          fromId_toId_linkType: {
            fromId: m.outflowId,
            toId: m.inflowId,
            linkType: 'transfer',
          },
        },
        create: {
          fromId: m.outflowId,
          toId: m.inflowId,
          linkType: 'transfer',
          amount: m.amount,
          notes: m.crossesBoundary
            ? `Auto-paired internal transfer (${m.boundary})`
            : 'Auto-paired internal transfer',
        },
        update: {},
      });

      // Tag boundary crossings so the review UI / brain can surface owner draws
      // and contributions rather than burying them as plain transfers.
      if (m.crossesBoundary) {
        const reason =
          m.boundary === 'business_to_personal' ? 'owner_draw' : 'owner_contribution';
        for (const id of [m.outflowId, m.inflowId]) {
          const existing = await db.transaction.findUnique({
            where: { id },
            select: { metadata: true },
          });
          await db.transaction.update({
            where: { id },
            data: {
              metadata: {
                ...((existing?.metadata as object) ?? {}),
                transferException: reason,
              },
            },
          });
        }
      }
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
