import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { listSquarePayments, mapSquarePayment, refreshSquareToken } from '@/lib/square';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { accountId, syncOrders = false } = await request.json();
    
    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    // Get the Square account with its connection
    const account = await db.financialAccount.findFirst({
      where: {
        id: accountId,
        userId: session.user.id,
      },
      include: {
        squareConnection: true,
      },
    });

    if (!account || !account.squareConnection) {
      return NextResponse.json({ error: 'Square account not found' }, { status: 404 });
    }

    const connection = account.squareConnection;
    let accessToken = connection.accessToken;

    // Check if token is expired and refresh if needed
    if (connection.expiresAt && new Date(connection.expiresAt) < new Date()) {
      if (connection.refreshToken) {
        try {
          const refreshed = await refreshSquareToken(connection.refreshToken);
          accessToken = refreshed.accessToken || accessToken;

          // Update stored tokens
          await db.squareConnection.update({
            where: { id: connection.id },
            data: {
              accessToken: refreshed.accessToken || connection.accessToken,
              refreshToken: refreshed.refreshToken || connection.refreshToken,
              expiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt) : connection.expiresAt,
            },
          });
        } catch (refreshError) {
          console.error('Failed to refresh Square token:', refreshError);
          return NextResponse.json({ error: 'Square token expired, please reconnect' }, { status: 401 });
        }
      }
    }

    // Calculate date range (last 30 days by default)
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let added = 0;
    let totalBalance = 0;

    // Sync payments
    const { payments } = await listSquarePayments({
      accessToken,
      beginTime: startTime,
      endTime,
      limit: 500, // Get up to 500 payments
    });

    for (const payment of payments) {
      if (payment.status !== 'COMPLETED') continue;

      const mapped = mapSquarePayment(payment);
      
      // Check if transaction already exists
      const existing = await db.transaction.findFirst({
        where: { externalId: `square_${mapped.id}` },
      });

      if (!existing) {
        await db.transaction.create({
          data: {
            accountId: account.id,
            amount: mapped.amount,
            type: 'INCOME', // Payments are income
            status: 'POSTED',
            date: new Date(mapped.date),
            description: mapped.description,
            externalId: `square_${mapped.id}`,
            isReviewed: false,
          },
        });
        added++;
        totalBalance += mapped.amount;
      }
    }

    // Optionally sync orders for more detailed transaction info
    if (syncOrders && connection.merchantId) {
      // Get locations for this merchant
      // Orders require location IDs
      // This would need additional implementation
    }

    // Calculate total balance from all completed transactions
    const allTransactions = await db.transaction.findMany({
      where: { accountId: account.id, status: 'POSTED' },
      select: { amount: true, type: true },
    });
    
    const calculatedBalance = allTransactions.reduce((sum, tx) => {
      const amount = Number(tx.amount);
      return tx.type === 'INCOME' ? sum + amount : sum - amount;
    }, 0);

    // Update account balance and sync time
    await db.financialAccount.update({
      where: { id: account.id },
      data: { 
        lastSyncedAt: new Date(),
        currentBalance: calculatedBalance,
      },
    });

    await db.squareConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      added,
      message: `Synced ${added} new transactions from Square`,
    });
  } catch (error) {
    console.error('Error syncing Square transactions:', error);
    return NextResponse.json(
      { error: 'Failed to sync Square transactions' },
      { status: 500 }
    );
  }
}
