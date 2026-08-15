import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dollarsToCents } from '@/lib/cashflow';
import { authorizeServiceRequest } from '@/lib/service-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(
    req,
    process.env.INTEGRATION_API_TOKEN,
    'INTEGRATION_API_TOKEN'
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get('limit')) || 500, 1),
    2000
  );
  const transactions = await db.transaction.findMany({
    where: {
      status: 'POSTED',
      reconciliationStatus: { in: ['UNMATCHED', 'PARTIAL'] },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    include: {
      account: { select: { id: true, name: true, type: true } },
      allocations: {
        where: { isCurrent: true },
        select: {
          id: true,
          amount: true,
          externalSystem: true,
          externalObjectType: true,
          externalObjectId: true,
          role: true,
          method: true,
          confidence: true,
          acceptedAt: true,
        },
      },
      settlement: {
        select: {
          id: true,
          provider: true,
          externalId: true,
          reconciliationStatus: true,
        },
      },
    },
  });
  const hasMore = transactions.length > limit;
  const page = transactions.slice(0, limit);

  return NextResponse.json({
    contractVersion: 2,
    generatedAt: new Date().toISOString(),
    hasMore,
    transactions: page.map((transaction) => {
      const amountCents = Math.abs(dollarsToCents(transaction.amount));
      const matchedCents = transaction.allocations.reduce(
        (sum, allocation) => sum + Math.abs(dollarsToCents(allocation.amount)),
        0
      );
      return {
        id: transaction.id,
        date: transaction.date.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
        amountCents,
        type: transaction.type,
        description: transaction.description,
        merchantName: transaction.merchantName,
        account: transaction.account,
        reconciliationStatus: transaction.reconciliationStatus,
        reconciliationMethod: transaction.reconciliationMethod,
        matchedCents,
        unexplainedCents: Math.max(amountCents - matchedCents, 0),
        settlement: transaction.settlement,
        allocations: transaction.allocations.map((allocation) => ({
          ...allocation,
          amount: undefined,
          amountCents: dollarsToCents(allocation.amount),
          confidence:
            allocation.confidence === null ? null : Number(allocation.confidence),
        })),
      };
    }),
  });
}
