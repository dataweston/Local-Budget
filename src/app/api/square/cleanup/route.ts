import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { recordFinancialAudit } from '@/lib/financial-integrity';

// One-time cleanup for legacy Square ingestion.
// Supersedes order-based transactions that duplicate Square payment rows while
// preserving their provider and audit history.
//
// Usage:
// POST /api/square/cleanup
// Body: { accountId?: string }
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      accountId?: string;
    };

    const squareAccounts = await db.financialAccount.findMany({
      where: {
        userId: session.user.id,
        ...(body.accountId ? { id: body.accountId } : {}),
        squareConnectionId: { not: null },
      },
      select: { id: true },
    });

    if (squareAccounts.length === 0) {
      return NextResponse.json({
        success: true,
        accountsProcessed: 0,
        supersededSquareOrders: 0,
        message: 'No Square-linked accounts found to clean.',
      });
    }

    const accountIds = squareAccounts.map((account) => account.id);
    const candidates = await db.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        externalId: { startsWith: 'square_order_' },
        status: { not: 'SUPERSEDED' },
      },
    });
    const supersededAt = new Date();
    await db.$transaction(async (tx) => {
      for (const transaction of candidates) {
        const after = await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'SUPERSEDED', removedAt: supersededAt },
        });
        await recordFinancialAudit(tx, {
          userId: session.user.id,
          actorUserId: session.user.id,
          transactionId: transaction.id,
          financialAccountId: transaction.accountId,
          action: 'SQUARE_ORDER_SUPERSEDED',
          source: 'MANUAL',
          reason: 'Legacy Square order duplicates its payment transaction',
          changedFields: ['status', 'removedAt'],
          before: transaction,
          after,
        });
      }
    });

    return NextResponse.json({
      success: true,
      accountsProcessed: accountIds.length,
      supersededSquareOrders: candidates.length,
      message: `Superseded ${candidates.length} Square order transactions.`,
    });
  } catch (error) {
    console.error('Error cleaning Square transactions:', error);
    return NextResponse.json(
      { error: 'Failed to clean Square transactions' },
      { status: 500 }
    );
  }
}
