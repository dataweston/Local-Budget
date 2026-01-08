import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { syncTransactions, getAccountBalances, mapPlaidTransaction } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { plaidItemId } = await request.json();

    // Get the Plaid item with its accounts
    const plaidItem = await db.plaidItem.findFirst({
      where: {
        id: plaidItemId,
        userId: session.user.id,
      },
      include: {
        plaidAccounts: true,
        accounts: true, // FinancialAccounts linked to this PlaidItem
      },
    });

    if (!plaidItem) {
      return NextResponse.json({ error: 'Plaid item not found' }, { status: 404 });
    }

    // Sync transactions using the cursor-based sync API
    let cursor = plaidItem.cursor || undefined;
    let hasMore = true;
    let added = 0;
    let modified = 0;
    let removed = 0;
    let skippedNoAccount = 0;

    // Log available accounts for debugging
    console.log(`[Plaid Sync] Starting sync for PlaidItem ${plaidItem.id}`);
    console.log(`[Plaid Sync] Available FinancialAccounts:`, plaidItem.accounts.map(
      (a: { id: string; plaidAccountId: string | null; name: string }) => 
        ({ id: a.id, plaidAccountId: a.plaidAccountId, name: a.name })
    ));
    console.log(`[Plaid Sync] PlaidAccounts:`, plaidItem.plaidAccounts.map(
      (a: { id: string; accountId: string; name: string }) => 
        ({ id: a.id, accountId: a.accountId, name: a.name })
    ));

    while (hasMore) {
      const syncResponse = await syncTransactions(plaidItem.accessToken, cursor);
      console.log(`[Plaid Sync] Received ${syncResponse.added.length} added, ${syncResponse.modified.length} modified, ${syncResponse.removed.length} removed transactions`);
      
      // Process added transactions
      for (const transaction of syncResponse.added) {
        const mappedTx = mapPlaidTransaction(transaction);
        
        // Find the matching financial account by plaidAccountId
        const financialAccount = plaidItem.accounts.find(
          (a: { plaidAccountId: string | null }) => a.plaidAccountId === mappedTx.accountId
        );
        
        if (!financialAccount) {
          console.log(`[Plaid Sync] Skipping transaction ${mappedTx.transactionId}: No matching account for plaidAccountId ${mappedTx.accountId}`);
          skippedNoAccount++;
          continue;
        }

        // Check if transaction already exists
        const existing = await db.transaction.findFirst({
          where: { externalId: mappedTx.transactionId },
        });

        if (!existing) {
          // Plaid convention: positive = money OUT (expense), negative = money IN (income)
          await db.transaction.create({
            data: {
              accountId: financialAccount.id,
              amount: Math.abs(mappedTx.amount), // Plaid uses negative for income
              type: mappedTx.amount > 0 ? 'EXPENSE' : 'INCOME',
              status: mappedTx.pending ? 'PENDING' : 'POSTED',
              date: new Date(mappedTx.date),
              description: mappedTx.name,
              merchantName: mappedTx.merchantName,
              externalId: mappedTx.transactionId,
              isReviewed: false,
            },
          });
          added++;
        }
      }

      // Process modified transactions
      for (const transaction of syncResponse.modified) {
        const mappedTx = mapPlaidTransaction(transaction);
        
        // Plaid convention: positive = money OUT (expense), negative = money IN (income)
        await db.transaction.updateMany({
          where: { externalId: mappedTx.transactionId },
          data: {
            amount: Math.abs(mappedTx.amount),
            type: mappedTx.amount > 0 ? 'EXPENSE' : 'INCOME',
            status: mappedTx.pending ? 'PENDING' : 'POSTED',
            description: mappedTx.name,
            merchantName: mappedTx.merchantName,
          },
        });
        modified++;
      }

      // Process removed transactions
      for (const removedTx of syncResponse.removed) {
        await db.transaction.deleteMany({
          where: { externalId: removedTx.transaction_id },
        });
        removed++;
      }

      // Update cursor
      cursor = syncResponse.next_cursor;
      hasMore = syncResponse.has_more;
    }

    // Update the cursor in the database
    await db.plaidItem.update({
      where: { id: plaidItem.id },
      data: { 
        cursor: cursor,
        lastSyncedAt: new Date(),
      },
    });

    // Also update account balances
    const balancesResponse = await getAccountBalances(plaidItem.accessToken);
    for (const account of balancesResponse.accounts) {
      const financialAccount = plaidItem.accounts.find(
        (a: { plaidAccountId: string | null }) => a.plaidAccountId === account.account_id
      );
      
      if (financialAccount) {
        await db.financialAccount.update({
          where: { id: financialAccount.id },
          data: {
            currentBalance: account.balances.current || 0,
            availableBalance: account.balances.available || undefined,
            lastSyncedAt: new Date(),
          },
        });
      }
    }

    console.log(`[Plaid Sync] Complete: ${added} added, ${modified} modified, ${removed} removed, ${skippedNoAccount} skipped (no matching account)`);

    return NextResponse.json({
      success: true,
      added,
      modified,
      removed,
      skippedNoAccount,
    });
  } catch (error) {
    console.error('[Plaid Sync] Error syncing transactions:', error);
    return NextResponse.json(
      { error: 'Failed to sync transactions' },
      { status: 500 }
    );
  }
}
