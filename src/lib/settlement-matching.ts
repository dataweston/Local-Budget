/**
 * Link processor payouts to the bank deposits that carry them.
 *
 * The per-payout matcher in the Square sync handles the common case: one payout
 * arrives as one bank credit. It cannot handle the other case, which is roughly
 * a third of payout days — Square batches several payouts into a single deposit,
 * so no individual payout amount ever appears on the bank statement.
 *
 * This pass closes that gap by searching for the *group* of same-day payouts
 * whose amounts sum to a deposit, then writing one BANK_SETTLEMENT allocation
 * per payout against that shared deposit. `refreshTransactionReconciliation`
 * already totals allocations per transaction, so the deposit flips to MATCHED
 * once its whole group is allocated and stays PARTIAL while it is incomplete.
 *
 * Ambiguity is never auto-accepted. With dozens of small same-day payouts more
 * than one combination can hit the same deposit total, and picking arbitrarily
 * would silently attribute revenue to the wrong payouts — measured on live data
 * that would have mis-bound 62 payouts across two days. Those are reported and
 * left for review instead.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { refreshTransactionReconciliation } from './financial-integrity';
import { findExactSubset, settlementBankDateWindow } from './settlements';

type FinancialDb = Prisma.TransactionClient | PrismaClient;

export interface BatchedSettlementSummary {
  daysExamined: number;
  linkedSettlements: number;
  linkedDeposits: number;
  ambiguousSettlements: number;
  ambiguousDays: string[];
  unexplainedSettlements: number;
}

export interface MatchBatchedOptions {
  /** Write allocations. Defaults to false (preview only). */
  apply?: boolean;
}

const toCents = (value: Prisma.Decimal | number) => Math.round(Number(value) * 100);

export async function matchBatchedSettlements(
  db: PrismaClient,
  userId: string,
  processorAccountId: string,
  options: MatchBatchedOptions = {}
): Promise<BatchedSettlementSummary> {
  const apply = options.apply ?? false;

  const settlements = await db.processorSettlement.findMany({
    where: {
      accountId: processorAccountId,
      reconciliationStatus: { not: 'MATCHED' },
    },
    select: {
      id: true,
      externalId: true,
      provider: true,
      amount: true,
      currency: true,
      effectiveAt: true,
      arrivalDate: true,
      transactionId: true,
    },
  });

  type SettlementRow = (typeof settlements)[number];
  const byDay = new Map<string, SettlementRow[]>();
  for (const settlement of settlements) {
    const day = (settlement.arrivalDate ?? settlement.effectiveAt).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), settlement]);
  }

  const summary: BatchedSettlementSummary = {
    daysExamined: byDay.size,
    linkedSettlements: 0,
    linkedDeposits: 0,
    ambiguousSettlements: 0,
    ambiguousDays: [],
    unexplainedSettlements: 0,
  };

  for (const [day, group] of Array.from(byDay.entries())) {
    const { from, to } = settlementBankDateWindow(new Date(`${day}T00:00:00.000Z`));
    const deposits = await db.transaction.findMany({
      where: {
        account: { userId, plaidAccountId: { not: null } },
        accountId: { not: processorAccountId },
        status: 'POSTED',
        type: { in: ['INCOME', 'TRANSFER'] },
        date: { gte: from, lte: to },
      },
      select: { id: true, amount: true },
      orderBy: { date: 'asc' },
    });

    let pool = group.map((settlement) => ({ item: settlement, cents: toCents(settlement.amount) }));

    for (const deposit of deposits) {
      if (!pool.length) break;
      const match = findExactSubset(pool, toCents(deposit.amount));
      if (!match) continue;

      if (!match.unique) {
        summary.ambiguousSettlements += match.items.length;
        if (!summary.ambiguousDays.includes(day)) summary.ambiguousDays.push(day);
        continue;
      }

      if (apply) {
        await db.$transaction(async (tx) => {
          for (const settlement of match.items) {
            await tx.reconciliationAllocation.upsert({
              where: {
                transactionId_externalSystem_externalObjectType_externalObjectId_role: {
                  transactionId: deposit.id,
                  externalSystem: settlement.provider,
                  externalObjectType: 'PAYOUT',
                  externalObjectId: settlement.externalId,
                  role: 'BANK_SETTLEMENT',
                },
              },
              create: {
                transactionId: deposit.id,
                userId,
                settlementId: settlement.id,
                externalSystem: settlement.provider,
                externalObjectType: 'PAYOUT',
                externalObjectId: settlement.externalId,
                role: 'BANK_SETTLEMENT',
                amount: settlement.amount,
                currency: settlement.currency,
                // Lower than the 0.95 the sync uses for a direct one-to-one
                // amount hit: a unique subset is solid but still inferred.
                method: 'AUTO',
                confidence: new Prisma.Decimal(match.items.length === 1 ? 0.95 : 0.8),
                isCurrent: true,
                removedAt: null,
              },
              update: {
                settlementId: settlement.id,
                amount: settlement.amount,
                currency: settlement.currency,
                method: 'AUTO',
                isCurrent: true,
                removedAt: null,
              },
            });

            await tx.processorSettlement.update({
              where: { id: settlement.id },
              data: { reconciliationStatus: 'MATCHED', reconciledAt: new Date() },
            });
            if (settlement.transactionId) {
              await refreshTransactionReconciliation(tx, settlement.transactionId);
            }
          }
          await refreshTransactionReconciliation(tx, deposit.id);
        });
      }

      summary.linkedSettlements += match.items.length;
      summary.linkedDeposits += 1;
      const taken = new Set(match.items.map((s) => s.id));
      pool = pool.filter((entry) => !taken.has(entry.item.id));
    }

    summary.unexplainedSettlements += pool.length;
  }

  return summary;
}
