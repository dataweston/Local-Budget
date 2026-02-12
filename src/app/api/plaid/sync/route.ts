import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { syncTransactions, getAccountBalances, mapPlaidTransaction, getAllTransactions } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { plaidItemId, fullSync = false } = await request.json();

    console.log(`[Plaid Sync] Received request for plaidItemId: ${plaidItemId}, fullSync: ${fullSync}`);

    // Get the Plaid item with its accounts
    // Note: plaidItemId from UI is PlaidItem.itemId (Plaid's ID), not PlaidItem.id (our DB cuid)
    const plaidItem = await db.plaidItem.findFirst({
      where: {
        itemId: plaidItemId, // Query by itemId, not id
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

    let added = 0;
    let modified = 0;
    let removed = 0;
    let skippedNoAccount = 0;

    // If fullSync is requested OR no cursor exists, use transactionsGet for full year history
    if (fullSync || !plaidItem.cursor) {
      console.log(`[Plaid Sync] Performing full historical sync (365 days)`);
      
      // Calculate date range (last 365 days)
      const endDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      console.log(`[Plaid Sync] Fetching transactions from ${startDate} to ${endDate}`);
      
      const allTransactions = await getAllTransactions(plaidItem.accessToken, startDate, endDate);
      console.log(`[Plaid Sync] Retrieved ${allTransactions.length} total transactions from Plaid`);

      for (const transaction of allTransactions) {
        const mappedTx = mapPlaidTransaction(transaction);
        
        // Find the matching financial account by plaidAccountId
        const financialAccount = plaidItem.accounts.find(
          (a: { plaidAccountId: string | null }) => a.plaidAccountId === mappedTx.accountId
        );
        
        if (!financialAccount) {
          skippedNoAccount++;
          continue;
        }

        // Upsert transaction (insert or update if exists)
        const existing = await db.transaction.findFirst({
          where: { externalId: mappedTx.transactionId },
        });

        if (!existing) {
          await db.transaction.create({
            data: {
              accountId: financialAccount.id,
              amount: Math.abs(mappedTx.amount),
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
        } else {
          await db.transaction.update({
            where: { id: existing.id },
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
      }

      // After full sync, do a cursor sync to set the cursor for future incremental syncs
      try {
        const syncResponse = await syncTransactions(plaidItem.accessToken);
        // Update cursor for future incremental syncs
        await db.plaidItem.update({
          where: { id: plaidItem.id },
          data: { 
            cursor: syncResponse.next_cursor,
            lastSyncedAt: new Date(),
          },
        });
      } catch (cursorError) {
        console.log('[Plaid Sync] Could not set cursor after full sync:', cursorError);
      }
    } else {
      // Use cursor-based incremental sync with retry on stale cursor
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let syncComplete = false;

      while (!syncComplete && retryCount < MAX_RETRIES) {
        try {
          console.log(`[Plaid Sync] Performing incremental sync from cursor (attempt ${retryCount + 1})`);
          // On retry, re-read the cursor from DB in case a previous partial run updated it
          let cursor: string | undefined;
          if (retryCount > 0) {
            const refreshed = await db.plaidItem.findUnique({
              where: { id: plaidItem.id },
              select: { cursor: true },
            });
            cursor = refreshed?.cursor || undefined;
            // Reset counters for the fresh attempt
            added = 0;
            modified = 0;
            removed = 0;
            skippedNoAccount = 0;
          } else {
            cursor = plaidItem.cursor || undefined;
          }

          let hasMore = true;

          while (hasMore) {
            const syncResponse = await syncTransactions(plaidItem.accessToken, cursor);
            console.log(`[Plaid Sync] Received ${syncResponse.added.length} added, ${syncResponse.modified.length} modified, ${syncResponse.removed.length} removed transactions`);

            // Process added transactions
            for (const transaction of syncResponse.added) {
              const mappedTx = mapPlaidTransaction(transaction);

              const financialAccount = plaidItem.accounts.find(
                (a: { plaidAccountId: string | null }) => a.plaidAccountId === mappedTx.accountId
              );

              if (!financialAccount) {
                console.log(`[Plaid Sync] Skipping transaction ${mappedTx.transactionId}: No matching account for plaidAccountId ${mappedTx.accountId}`);
                skippedNoAccount++;
                continue;
              }

              const existing = await db.transaction.findFirst({
                where: { externalId: mappedTx.transactionId },
              });

              if (!existing) {
                await db.transaction.create({
                  data: {
                    accountId: financialAccount.id,
                    amount: Math.abs(mappedTx.amount),
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

          syncComplete = true;
        } catch (syncError: any) {
          const plaidErrorCode = syncError?.response?.data?.error_code;
          if (plaidErrorCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') {
            retryCount++;
            console.log(`[Plaid Sync] Cursor stale (mutation during pagination), attempt ${retryCount}/${MAX_RETRIES}`);

            if (retryCount >= MAX_RETRIES) {
              // All retries exhausted — reset cursor and fall back to fresh sync
              console.log(`[Plaid Sync] Retries exhausted. Resetting cursor to force fresh sync next time.`);
              await db.plaidItem.update({
                where: { id: plaidItem.id },
                data: { cursor: null },
              });

              // Try one final empty-cursor sync to get a fresh cursor
              try {
                const freshSync = await syncTransactions(plaidItem.accessToken);
                await db.plaidItem.update({
                  where: { id: plaidItem.id },
                  data: {
                    cursor: freshSync.next_cursor,
                    lastSyncedAt: new Date(),
                  },
                });
                console.log(`[Plaid Sync] Fresh cursor obtained after reset. Sync will complete fully on next attempt.`);
                syncComplete = true;
              } catch (resetError) {
                console.error(`[Plaid Sync] Failed to obtain fresh cursor after reset:`, resetError);
                throw syncError;
              }
            }
          } else {
            throw syncError;
          }
        }
      }
    }

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
  } catch (error: any) {
    console.error('[Plaid Sync] Error syncing transactions:', error);
    const plaidError = error?.response?.data;
    return NextResponse.json(
      {
        error: 'Failed to sync transactions',
        plaidErrorCode: plaidError?.error_code || null,
        plaidErrorMessage: plaidError?.error_message || null,
      },
      { status: 500 }
    );
  }
}
