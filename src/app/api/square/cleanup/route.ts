import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

// One-time cleanup for legacy Square ingestion.
// - Deletes Square order-based transactions (these often duplicate Square payment transactions)
// - Safe-ish because it targets only `externalId` prefixed with `square_order_`
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
        deletedSquareOrders: 0,
        message: 'No Square-linked accounts found to clean.',
      });
    }

    const accountIds = squareAccounts.map((a) => a.id);

    const toDeleteCount = await db.transaction.count({
      where: {
        accountId: { in: accountIds },
        externalId: { startsWith: 'square_order_' },
      },
    });

    const deleted = await db.transaction.deleteMany({
      where: {
        accountId: { in: accountIds },
        externalId: { startsWith: 'square_order_' },
      },
    });

    return NextResponse.json({
      success: true,
      accountsProcessed: accountIds.length,
      deletedSquareOrders: deleted.count,
      expectedToDelete: toDeleteCount,
      message: `Deleted ${deleted.count} Square order transactions.`,
    });
  } catch (error) {
    console.error('Error cleaning Square transactions:', error);
    return NextResponse.json(
      { error: 'Failed to clean Square transactions' },
      { status: 500 }
    );
  }
}
