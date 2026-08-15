import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dollarsToCents } from '@/lib/cashflow';
import { authorizeServiceRequest } from '@/lib/service-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const auth = authorizeServiceRequest(
    req,
    process.env.INTEGRATION_API_TOKEN,
    'INTEGRATION_API_TOKEN'
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const transaction = await db.transaction.findUnique({
    where: { id: context.params.id },
    include: {
      account: { select: { id: true, name: true, type: true, currency: true } },
      category: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      payer: { select: { id: true, name: true, type: true } },
      incurredBy: { select: { id: true, name: true, type: true } },
      splits: {
        orderBy: { createdAt: 'asc' },
        include: { category: { select: { id: true, name: true } } },
      },
      sourceIdentities: { orderBy: { firstSeenAt: 'asc' } },
      allocations: {
        orderBy: { acceptedAt: 'asc' },
        include: {
          settlement: {
            select: { id: true, provider: true, externalId: true, status: true },
          },
          settlementEntry: {
            select: { id: true, providerEntryId: true, type: true },
          },
        },
      },
      settlement: {
        include: { entries: { orderBy: { effectiveAt: 'asc' } } },
      },
      auditEvents: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          actorUserId: true,
          action: true,
          source: true,
          reason: true,
          changedFields: true,
          before: true,
          after: true,
          createdAt: true,
        },
      },
    },
  });
  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  const matchedCents = transaction.allocations
    .filter((allocation) => allocation.isCurrent)
    .reduce(
      (sum, allocation) => sum + Math.abs(dollarsToCents(allocation.amount)),
      0
    );
  const amountCents = Math.abs(dollarsToCents(transaction.amount));

  return NextResponse.json({
    contractVersion: 2,
    generatedAt: new Date().toISOString(),
    transaction: {
      ...transaction,
      amount: undefined,
      amountCents,
      date: transaction.date.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
      reconciledAt: transaction.reconciledAt?.toISOString() ?? null,
      removedAt: transaction.removedAt?.toISOString() ?? null,
      matchedCents,
      unexplainedCents: Math.max(amountCents - matchedCents, 0),
      splits: transaction.splits.map((split) => ({
        ...split,
        amount: undefined,
        amountCents: dollarsToCents(split.amount),
      })),
      allocations: transaction.allocations.map((allocation) => ({
        ...allocation,
        amount: undefined,
        amountCents: dollarsToCents(allocation.amount),
        confidence:
          allocation.confidence === null ? null : Number(allocation.confidence),
      })),
      settlement: transaction.settlement
        ? {
            ...transaction.settlement,
            amount: undefined,
            amountCents: dollarsToCents(transaction.settlement.amount),
            entries: transaction.settlement.entries.map((entry) => ({
              ...entry,
              grossAmount: undefined,
              feeAmount: undefined,
              netAmount: undefined,
              grossAmountCents: dollarsToCents(entry.grossAmount),
              feeAmountCents: dollarsToCents(entry.feeAmount),
              netAmountCents: dollarsToCents(entry.netAmount),
            })),
          }
        : null,
    },
  });
}
