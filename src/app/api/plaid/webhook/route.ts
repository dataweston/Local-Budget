import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncTransactions, getAccountBalances } from '@/lib/plaid';

// Plaid webhook event types
type PlaidWebhookType = 
  | 'TRANSACTIONS'
  | 'ITEM'
  | 'HOLDINGS'
  | 'INVESTMENTS_TRANSACTIONS'
  | 'LIABILITIES'
  | 'ASSETS'
  | 'AUTH'
  | 'IDENTITY';

interface PlaidWebhookBody {
  webhook_type: PlaidWebhookType;
  webhook_code: string;
  item_id: string;
  error?: {
    error_type: string;
    error_code: string;
    error_message: string;
  };
  new_transactions?: number;
  removed_transactions?: string[];
}

// In production, you should verify the webhook signature
// See: https://plaid.com/docs/api/webhooks/webhook-verification/
async function verifyPlaidWebhook(request: NextRequest): Promise<boolean> {
  // For production, implement signature verification using:
  // - Plaid-Verification header
  // - plaid.webhookVerificationKeyGet()
  // - JWT verification
  
  // For now, we'll do a basic check
  const plaidVersion = request.headers.get('plaid-verification');
  
  // In development/sandbox, skip verification
  if (process.env.PLAID_ENV === 'sandbox') {
    return true;
  }
  
  // TODO: Implement proper signature verification for production
  return !!plaidVersion;
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook authenticity
    const isValid = await verifyPlaidWebhook(request);
    if (!isValid && process.env.PLAID_ENV !== 'sandbox') {
      console.error('Invalid Plaid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body: PlaidWebhookBody = await request.json();
    const { webhook_type, webhook_code, item_id, error } = body;

    console.log(`Plaid webhook received: ${webhook_type}/${webhook_code} for item ${item_id}`);

    // Find the PlaidItem in our database
    const plaidItem = await db.plaidItem.findUnique({
      where: { itemId: item_id },
      include: { accounts: true },
    });

    if (!plaidItem) {
      console.error(`PlaidItem not found for item_id: ${item_id}`);
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Handle different webhook types
    switch (webhook_type) {
      case 'TRANSACTIONS':
        await handleTransactionsWebhook(webhook_code, plaidItem, body);
        break;

      case 'ITEM':
        await handleItemWebhook(webhook_code, plaidItem, error);
        break;

      default:
        console.log(`Unhandled webhook type: ${webhook_type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Plaid webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleTransactionsWebhook(
  code: string,
  plaidItem: { id: string; itemId: string; accessToken: string; cursor: string | null; accounts: { id: string }[] },
  body: PlaidWebhookBody
) {
  switch (code) {
    case 'SYNC_UPDATES_AVAILABLE':
    case 'INITIAL_UPDATE':
    case 'HISTORICAL_UPDATE':
    case 'DEFAULT_UPDATE':
      // Sync new transactions
      console.log(`Syncing transactions for item ${plaidItem.itemId}`);
      
      try {
        const result = await syncTransactions(
          plaidItem.accessToken,
          plaidItem.cursor || undefined
        );

        // Process added transactions
        for (const tx of result.added) {
          // Find the corresponding FinancialAccount
          const account = await db.financialAccount.findFirst({
            where: { 
              plaidAccountId: tx.account_id,
              plaidItemId: plaidItem.itemId,
            },
          });

          if (account) {
            // Check if transaction already exists
            const existing = await db.transaction.findFirst({
              where: { 
                accountId: account.id,
                externalId: tx.transaction_id,
              },
            });

            if (!existing) {
              await db.transaction.create({
                data: {
                  accountId: account.id,
                  amount: Math.abs(tx.amount),
                  type: tx.amount < 0 ? 'INCOME' : 'EXPENSE',
                  status: tx.pending ? 'PENDING' : 'POSTED',
                  date: new Date(tx.date),
                  description: tx.name,
                  merchantName: tx.merchant_name,
                  externalId: tx.transaction_id,
                  metadata: {
                    plaid_category: tx.category,
                    plaid_category_id: tx.category_id,
                    payment_channel: tx.payment_channel,
                  },
                },
              });
            }
          }
        }

        // Handle modified transactions
        for (const tx of result.modified) {
          const account = await db.financialAccount.findFirst({
            where: { plaidAccountId: tx.account_id },
          });

          if (account) {
            await db.transaction.updateMany({
              where: { 
                accountId: account.id,
                externalId: tx.transaction_id,
              },
              data: {
                amount: Math.abs(tx.amount),
                type: tx.amount < 0 ? 'INCOME' : 'EXPENSE',
                status: tx.pending ? 'PENDING' : 'POSTED',
                description: tx.name,
                merchantName: tx.merchant_name,
              },
            });
          }
        }

        // Handle removed transactions
        for (const removed of result.removed) {
          const txId = typeof removed === 'string' ? removed : removed.transaction_id;
          await db.transaction.deleteMany({
            where: { externalId: txId },
          });
        }

        // Update cursor
        await db.plaidItem.update({
          where: { id: plaidItem.id },
          data: { 
            cursor: result.next_cursor,
            lastSyncedAt: new Date(),
          },
        });

        // Update account balances
        try {
          const balanceResponse = await getAccountBalances(plaidItem.accessToken);
          for (const balance of balanceResponse.accounts) {
            await db.financialAccount.updateMany({
              where: { plaidAccountId: balance.account_id },
              data: {
                currentBalance: balance.balances.current ?? 0,
                availableBalance: balance.balances.available ?? null,
              },
            });
          }
        } catch (balanceError) {
          console.error('Error updating balances:', balanceError);
        }

        console.log(`Synced ${result.added.length} new, ${result.modified.length} modified, ${result.removed.length} removed transactions`);
      } catch (syncError) {
        console.error('Error syncing transactions:', syncError);
        throw syncError;
      }
      break;

    case 'TRANSACTIONS_REMOVED':
      // Handle bulk transaction removal
      if (body.removed_transactions) {
        for (const txId of body.removed_transactions) {
          await db.transaction.deleteMany({
            where: { externalId: txId },
          });
        }
        console.log(`Removed ${body.removed_transactions.length} transactions`);
      }
      break;

    default:
      console.log(`Unhandled transactions webhook code: ${code}`);
  }
}

async function handleItemWebhook(
  code: string,
  plaidItem: { id: string; itemId: string },
  error?: { error_type: string; error_code: string; error_message: string }
) {
  switch (code) {
    case 'ERROR':
      // Item has an error - update status
      await db.plaidItem.update({
        where: { id: plaidItem.id },
        data: {
          status: 'error',
          errorCode: error?.error_code || 'UNKNOWN_ERROR',
        },
      });
      console.error(`Plaid item error for ${plaidItem.itemId}:`, error);
      break;

    case 'PENDING_EXPIRATION':
      // Access token will expire soon - notify user
      await db.plaidItem.update({
        where: { id: plaidItem.id },
        data: { status: 'pending_expiration' },
      });
      // TODO: Send notification to user to re-authenticate
      console.warn(`Plaid item ${plaidItem.itemId} access token expiring soon`);
      break;

    case 'USER_PERMISSION_REVOKED':
      // User revoked access - mark as inactive
      await db.plaidItem.update({
        where: { id: plaidItem.id },
        data: { status: 'revoked' },
      });
      console.log(`User revoked access for item ${plaidItem.itemId}`);
      break;

    case 'WEBHOOK_UPDATE_ACKNOWLEDGED':
      // Webhook URL was updated successfully
      console.log(`Webhook URL update acknowledged for item ${plaidItem.itemId}`);
      break;

    default:
      console.log(`Unhandled item webhook code: ${code}`);
  }
}

// Handle GET requests (for webhook URL verification)
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'Plaid webhook endpoint active' });
}
