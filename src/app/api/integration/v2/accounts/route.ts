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

  const accounts = await db.financialAccount.findMany({
    where: { isActive: true },
    orderBy: [{ institution: 'asc' }, { name: 'asc' }],
    include: {
      balanceSnapshots: {
        orderBy: { effectiveAt: 'desc' },
        take: 1,
      },
      _count: {
        select: {
          transactions: {
            where: {
              status: 'POSTED',
              reconciliationStatus: { in: ['UNMATCHED', 'PARTIAL'] },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    contractVersion: 2,
    generatedAt: new Date().toISOString(),
    accounts: accounts.map((account) => {
      const snapshot = account.balanceSnapshots[0] ?? null;
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        institution: account.institution,
        lastFour: account.accountNumber,
        currency: account.currency,
        active: account.isActive,
        internal: account.isInternal,
        currentBalanceCents: dollarsToCents(account.currentBalance),
        availableBalanceCents:
          account.availableBalance === null
            ? null
            : dollarsToCents(account.availableBalance),
        openingBalanceCents:
          account.openingBalance === null
            ? null
            : dollarsToCents(account.openingBalance),
        openingBalanceDate: account.openingBalanceDate?.toISOString() ?? null,
        latestBalanceEvidence: snapshot
          ? {
              balanceCents: dollarsToCents(snapshot.balance),
              availableBalanceCents:
                snapshot.availableBalance === null
                  ? null
                  : dollarsToCents(snapshot.availableBalance),
              effectiveAt: snapshot.effectiveAt.toISOString(),
              source: snapshot.source,
            }
          : null,
        lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
        unresolvedTransactionCount: account._count.transactions,
      };
    }),
  });
}
