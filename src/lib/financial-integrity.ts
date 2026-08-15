import { Prisma, type PrismaClient } from '@prisma/client';

type FinancialDb = Prisma.TransactionClient | PrismaClient;

type AuditInput = {
  userId: string;
  actorUserId?: string | null;
  transactionId?: string | null;
  financialAccountId?: string | null;
  action: string;
  source: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  changedFields: string[];
};

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item
    )
  ) as Prisma.InputJsonValue;
}

export function changedFinancialFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[]
): string[] {
  return fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])
  );
}

export async function recordFinancialAudit(db: FinancialDb, input: AuditInput) {
  return db.financialAuditEvent.create({
    data: {
      userId: input.userId,
      actorUserId: input.actorUserId ?? null,
      transactionId: input.transactionId ?? null,
      financialAccountId: input.financialAccountId ?? null,
      action: input.action,
      source: input.source,
      reason: input.reason ?? null,
      changedFields: input.changedFields,
      ...(input.before === undefined ? {} : { before: jsonValue(input.before) }),
      ...(input.after === undefined ? {} : { after: jsonValue(input.after) }),
    },
  });
}

export function transactionBalanceEffect(input: {
  amount: unknown;
  type: string;
  status: string;
  metadata?: unknown;
}): number {
  if (input.status !== 'POSTED') return 0;
  const amount = Math.abs(Number(input.amount));
  if (input.type === 'EXPENSE') return -amount;
  if (input.type === 'TRANSFER') {
    if (
      !input.metadata ||
      typeof input.metadata !== 'object' ||
      Array.isArray(input.metadata)
    ) {
      return 0;
    }
    const direction = (input.metadata as Record<string, unknown>).transferDirection;
    if (direction === 'out') return -amount;
    if (direction === 'in') return amount;
    return 0;
  }
  return amount;
}

export async function upsertTransactionSourceIdentity(
  db: FinancialDb,
  input: {
    transactionId: string;
    sourceSystem: string;
    sourceAccountId: string;
    externalId: string;
    isCurrent?: boolean;
    removedAt?: Date | null;
    metadata?: Prisma.InputJsonValue;
  }
) {
  const now = new Date();
  return db.transactionSourceIdentity.upsert({
    where: {
      sourceSystem_sourceAccountId_externalId: {
        sourceSystem: input.sourceSystem,
        sourceAccountId: input.sourceAccountId,
        externalId: input.externalId,
      },
    },
    create: {
      transactionId: input.transactionId,
      sourceSystem: input.sourceSystem,
      sourceAccountId: input.sourceAccountId,
      externalId: input.externalId,
      isCurrent: input.isCurrent ?? true,
      removedAt: input.removedAt ?? null,
      metadata: input.metadata,
    },
    update: {
      transactionId: input.transactionId,
      isCurrent: input.isCurrent ?? true,
      removedAt: input.removedAt ?? null,
      lastSeenAt: now,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}

export async function refreshTransactionReconciliation(
  db: FinancialDb,
  transactionId: string
) {
  const transaction = await db.transaction.findUnique({
    where: { id: transactionId },
    select: {
      amount: true,
      reconciliationStatus: true,
      allocations: {
        where: { isCurrent: true },
        select: { amount: true, method: true, acceptedAt: true },
        orderBy: { acceptedAt: 'desc' },
      },
    },
  });
  if (!transaction || transaction.reconciliationStatus === 'EXCLUDED') return null;

  const matched = transaction.allocations.reduce(
    (total, allocation) => total + Math.abs(Number(allocation.amount)),
    0
  );
  const amount = Math.abs(Number(transaction.amount));
  const difference = amount - matched;
  const status =
    matched <= 0.01 ? 'UNMATCHED' : Math.abs(difference) <= 0.01 ? 'MATCHED' : 'PARTIAL';
  const latest = transaction.allocations[0];

  return db.transaction.update({
    where: { id: transactionId },
    data: {
      reconciliationStatus: status,
      reconciliationMethod: latest?.method ?? null,
      reconciledAt: status === 'MATCHED' ? latest?.acceptedAt ?? new Date() : null,
    },
  });
}
