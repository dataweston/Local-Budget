import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { listSquarePayments, mapSquarePayment, refreshSquareToken } from '@/lib/square';

function squarePaymentExternalId(paymentId: string) {
  return `square_${paymentId}`;
}

function squareOrderExternalId(orderId: string) {
  return `square_order_${orderId}`;
}

function squarePayoutExternalId(payoutId: string) {
  return `square_payout_${payoutId}`;
}

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

    // Calculate date range (last 90 days by default for more data)
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    let added = 0;

    // Sync payments
    console.log('Syncing Square payments from', startTime, 'to', endTime);
    const { payments } = await listSquarePayments({
      accessToken,
      beginTime: startTime,
      endTime,
      limit: 500, // Get up to 500 payments
    });
    
    console.log(`Found ${payments.length} payments from Square`);

    for (const payment of payments) {
      if (payment.status !== 'COMPLETED') continue;

      const mapped = mapSquarePayment(payment);

      const canonicalExternalId = squarePaymentExternalId(mapped.id);
      const legacyExternalId = mapped.id;

      // Clean up legacy IDs that were written by the webhook (payment.id)
      const existingRecords = await db.transaction.findMany({
        where: {
          accountId: account.id,
          OR: [
            { externalId: canonicalExternalId },
            { externalId: legacyExternalId },
          ],
        },
        select: { id: true, externalId: true },
      });

      const canonicalExisting = existingRecords.find(
        (t) => t.externalId === canonicalExternalId
      );
      const legacyExisting = existingRecords.find(
        (t) => t.externalId === legacyExternalId
      );

      const isNew = !canonicalExisting && !legacyExisting;

      if (canonicalExisting && legacyExisting) {
        await db.transaction.delete({ where: { id: legacyExisting.id } });
      } else if (!canonicalExisting && legacyExisting) {
        await db.transaction.update({
          where: { id: legacyExisting.id },
          data: { externalId: canonicalExternalId },
        });
      }
      
      await db.transaction.upsert({
        where: {
          accountId_externalId: {
            accountId: account.id,
            externalId: canonicalExternalId,
          },
        },
        create: {
          accountId: account.id,
          amount: mapped.amount,
          type: 'INCOME',
          status: 'POSTED',
          date: new Date(mapped.date),
          description: mapped.description,
          merchantName: 'Square Payment',
          externalId: canonicalExternalId,
          isReviewed: false,
        },
        update: {
          amount: mapped.amount,
          type: 'INCOME',
          status: 'POSTED',
          date: new Date(mapped.date),
          description: mapped.description,
          merchantName: 'Square Payment',
        },
      });

      if (isNew) added++;
    }

    // Optionally sync orders for more detailed transaction info
    if (syncOrders && connection.locationIds && connection.locationIds.length > 0) {
      try {
        const { listSquareOrders, mapSquareOrder } = await import('@/lib/square');
        const { orders } = await listSquareOrders({
          accessToken,
          locationIds: connection.locationIds,
          limit: 200,
        });
        
        console.log(`Found ${orders.length} orders from Square`);
        
        for (const order of orders) {
          if (order.state !== 'COMPLETED') continue;
          
          const mapped = mapSquareOrder(order);
          const externalId = squareOrderExternalId(mapped.id);

          const existing = await db.transaction.findUnique({
            where: {
              accountId_externalId: {
                accountId: account.id,
                externalId,
              },
            },
            select: { id: true },
          });
          
          await db.transaction.upsert({
            where: {
              accountId_externalId: {
                accountId: account.id,
                externalId,
              },
            },
            create: {
              accountId: account.id,
              amount: mapped.amount,
              type: 'INCOME',
              status: 'POSTED',
              date: new Date(mapped.date),
              description: mapped.description,
              merchantName: 'Square Order',
              externalId,
              isReviewed: false,
            },
            update: {
              amount: mapped.amount,
              type: 'INCOME',
              status: 'POSTED',
              date: new Date(mapped.date),
              description: mapped.description,
              merchantName: 'Square Order',
            },
          });

          if (!existing) added++;
        }
      } catch (orderError) {
        console.log('Error syncing orders (non-fatal):', orderError);
      }
    }

    // Sync payouts (bank transfers from Square to seller's bank account)
    try {
      const { listSquarePayouts, mapSquarePayout } = await import('@/lib/square');
      const { payouts } = await listSquarePayouts({
        accessToken,
        beginTime: startTime,
        endTime,
        limit: 200,
      });
      
      console.log(`Found ${payouts.length} payouts from Square`);
      
      for (const payout of payouts) {
        // Only sync completed payouts (PAID status)
        if (payout.status !== 'PAID') continue;
        
        const mapped = mapSquarePayout(payout);
        const externalId = squarePayoutExternalId(mapped.id);

        const existing = await db.transaction.findUnique({
          where: {
            accountId_externalId: {
              accountId: account.id,
              externalId,
            },
          },
          select: { id: true },
        });
        
        await db.transaction.upsert({
          where: {
            accountId_externalId: {
              accountId: account.id,
              externalId,
            },
          },
          create: {
            accountId: account.id,
            amount: mapped.amount,
            type: 'EXPENSE',
            status: 'POSTED',
            date: new Date(mapped.date),
            description: mapped.description,
            merchantName: 'Square Payout',
            externalId,
            isReviewed: false,
          },
          update: {
            amount: mapped.amount,
            type: 'EXPENSE',
            status: 'POSTED',
            date: new Date(mapped.date),
            description: mapped.description,
            merchantName: 'Square Payout',
          },
        });

        if (!existing) added++;
      }
    } catch (payoutError) {
      console.log('Error syncing payouts (non-fatal):', payoutError);
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
