import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  syncTransactions,
  getAccountBalances,
  plaidClient,
  mapPlaidTransaction,
  mergePlaidTransactionMetadata,
} from '@/lib/plaid';
import { jwtVerify, importJWK, type JWK } from 'jose';
import { createHash } from 'crypto';
import {
  getAmazonCategoryTargets,
  getAmazonRoutingCategoryId,
  getAmazonRoutingClassification,
} from '@/lib/amazon-routing';
import { getVenmoBankRouting } from '@/lib/venmo-routing';
import { upsertTransactionSourceIdentity } from '@/lib/financial-integrity';

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

// Cache for Plaid verification keys (key_id -> JWK)
const keyCache = new Map<string, { key: JWK; expiresAt: number }>();
const KEY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getPlaidVerificationKey(keyId: string): Promise<JWK> {
  const cached = keyCache.get(keyId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const response = await plaidClient.webhookVerificationKeyGet({ key_id: keyId });
  const jwk = response.data.key as unknown as JWK;
  keyCache.set(keyId, { key: jwk, expiresAt: Date.now() + KEY_CACHE_TTL });
  return jwk;
}

async function verifyPlaidWebhook(request: NextRequest, rawBody: string): Promise<boolean> {
  if (process.env.PLAID_ENV === 'sandbox') {
    return true;
  }

  const token = request.headers.get('plaid-verification');
  if (!token) {
    return false;
  }

  try {
    // Decode the JWT header to get the key ID
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    const keyId = header.kid;
    if (!keyId) return false;

    // Fetch the verification key from Plaid
    const jwk = await getPlaidVerificationKey(keyId);
    const key = await importJWK(jwk, 'ES256');

    // Verify the JWT signature and expiration
    const { payload } = await jwtVerify(token, key, {
      maxTokenAge: '5 min',
    });

    // Verify the request body hash matches
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    if (payload.request_body_sha256 !== bodyHash) {
      console.error('Plaid webhook body hash mismatch');
      return false;
    }

    return true;
  } catch (err) {
    console.error('Plaid webhook verification failed:', err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text();

    // Verify webhook authenticity
    const isValid = await verifyPlaidWebhook(request, rawBody);
    if (!isValid) {
      console.error('Invalid Plaid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body: PlaidWebhookBody = JSON.parse(rawBody);
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

async function tombstonePlaidTransaction(
  externalId: string,
  sourceAccountId?: string | null
) {
  const identities = await db.transactionSourceIdentity.findMany({
    where: {
      sourceSystem: 'PLAID',
      externalId,
      ...(sourceAccountId ? { sourceAccountId } : {}),
    },
    select: { transactionId: true },
  });
  const fallback = identities.length === 0
    ? await db.transaction.findMany({
        where: { externalId },
        select: { id: true },
      })
    : [];
  const transactionIds = [
    ...identities.map((identity) => identity.transactionId),
    ...fallback.map((transaction) => transaction.id),
  ];
  const removedAt = new Date();
  await db.$transaction([
    db.transaction.updateMany({
      where: { id: { in: transactionIds } },
      data: { status: 'REMOVED', removedAt },
    }),
    db.transactionSourceIdentity.updateMany({
      where: {
        sourceSystem: 'PLAID',
        externalId,
        ...(sourceAccountId ? { sourceAccountId } : {}),
      },
      data: { isCurrent: false, removedAt, lastSeenAt: removedAt },
    }),
  ]);
  return transactionIds.length;
}

async function handleTransactionsWebhook(
  code: string,
  plaidItem: {
    id: string;
    itemId: string;
    accessToken: string;
    cursor: string | null;
    userId: string;
    accounts: { id: string }[];
  },
  body: PlaidWebhookBody
) {
  const amazonTargets = await getAmazonCategoryTargets(db, plaidItem.userId);
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
          const mappedTx = mapPlaidTransaction(tx);
          // Find the corresponding FinancialAccount
          const account = await db.financialAccount.findFirst({
            where: { 
              plaidAccountId: tx.account_id,
              plaidItemId: plaidItem.itemId,
            },
          });

          if (!account) continue;

          const directExisting = await db.transaction.findFirst({
            where: {
              accountId: account.id,
              externalId: mappedTx.transactionId,
            },
          });
          const pendingIdentity = mappedTx.pendingTransactionId
            ? await db.transactionSourceIdentity.findUnique({
                where: {
                  sourceSystem_sourceAccountId_externalId: {
                    sourceSystem: 'PLAID',
                    sourceAccountId: mappedTx.accountId,
                    externalId: mappedTx.pendingTransactionId,
                  },
                },
                include: { transaction: true },
              })
            : null;
          const existing = directExisting ?? pendingIdentity?.transaction ?? null;
          const venmoRouting = getVenmoBankRouting({
            description: mappedTx.name,
            merchantName: mappedTx.merchantName,
          });
          const amazonInput = {
            description: mappedTx.name,
            merchantName: mappedTx.merchantName,
          };
          const amazonCategoryId = getAmazonRoutingCategoryId(amazonInput, amazonTargets);
          const amazonClassification = getAmazonRoutingClassification(amazonInput);

          await db.$transaction(async (transactionDb) => {
            const data = {
              accountId: account.id,
              amount: Math.abs(mappedTx.amount),
              type: (venmoRouting?.type ?? (mappedTx.amount < 0 ? 'INCOME' : 'EXPENSE')) as 'EXPENSE' | 'INCOME' | 'TRANSFER',
              status: mappedTx.pending ? 'PENDING' as const : 'POSTED' as const,
              removedAt: null,
              date: new Date(mappedTx.date),
              description: mappedTx.name,
              merchantName: mappedTx.merchantName,
              externalId: mappedTx.transactionId,
              metadata: mergePlaidTransactionMetadata(
                mappedTx,
                existing?.metadata,
                venmoRouting
                  ? { transferDirection: mappedTx.amount > 0 ? 'out' : 'in' }
                  : undefined
              ),
              ...(venmoRouting
                ? { classification: venmoRouting.classification, categoryId: null }
                : amazonCategoryId
                  ? {
                      categoryId: amazonCategoryId,
                      classification: amazonClassification ?? 'OPERATING',
                    }
                  : {}),
            };
            const stored = existing
              ? await transactionDb.transaction.update({ where: { id: existing.id }, data })
              : await transactionDb.transaction.create({ data });
            if (mappedTx.pendingTransactionId) {
              await transactionDb.transactionSourceIdentity.updateMany({
                where: {
                  sourceSystem: 'PLAID',
                  sourceAccountId: mappedTx.accountId,
                  externalId: mappedTx.pendingTransactionId,
                },
                data: { isCurrent: false, lastSeenAt: new Date() },
              });
            }
            await upsertTransactionSourceIdentity(transactionDb, {
              transactionId: stored.id,
              sourceSystem: 'PLAID',
              sourceAccountId: mappedTx.accountId,
              externalId: mappedTx.transactionId,
            });
          });
        }

        // Handle modified transactions
        for (const tx of result.modified) {
          const mappedTx = mapPlaidTransaction(tx);
          const account = await db.financialAccount.findFirst({
            where: { plaidAccountId: tx.account_id },
          });

          if (!account) continue;
          const existingTransaction = await db.transaction.findFirst({
            where: { accountId: account.id, externalId: tx.transaction_id },
            select: { id: true, metadata: true },
          });
          if (!existingTransaction) continue;
          const venmoRouting = getVenmoBankRouting({
            description: tx.name,
            merchantName: tx.merchant_name,
          });
          const amazonInput = { description: tx.name, merchantName: tx.merchant_name };
          const amazonCategoryId = getAmazonRoutingCategoryId(
            amazonInput,
            amazonTargets
          );
          const amazonClassification = getAmazonRoutingClassification(amazonInput);
          await db.$transaction(async (transactionDb) => {
            await transactionDb.transaction.update({
              where: { id: existingTransaction.id },
              data: {
                amount: Math.abs(tx.amount),
                type: (venmoRouting?.type ?? (tx.amount < 0 ? 'INCOME' : 'EXPENSE')) as 'EXPENSE' | 'INCOME' | 'TRANSFER',
                status: tx.pending ? 'PENDING' : 'POSTED',
                removedAt: null,
                description: tx.name,
                merchantName: tx.merchant_name,
                metadata: mergePlaidTransactionMetadata(
                  mappedTx,
                  existingTransaction.metadata,
                  venmoRouting
                    ? { transferDirection: mappedTx.amount > 0 ? 'out' : 'in' }
                    : undefined
                ),
                ...(venmoRouting
                  ? { classification: venmoRouting.classification, categoryId: null }
                  : amazonCategoryId
                    ? {
                        categoryId: amazonCategoryId,
                        classification: amazonClassification ?? 'OPERATING',
                      }
                    : {}),
              },
            });
            await upsertTransactionSourceIdentity(transactionDb, {
              transactionId: existingTransaction.id,
              sourceSystem: 'PLAID',
              sourceAccountId: mappedTx.accountId,
              externalId: mappedTx.transactionId,
            });
          });
        }

        // Handle removed transactions without destroying historical identity.
        for (const removed of result.removed) {
          const externalId = typeof removed === 'string' ? removed : removed.transaction_id;
          const sourceAccountId = typeof removed === 'string' ? null : removed.account_id;
          await tombstonePlaidTransaction(externalId, sourceAccountId);
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
            const account = await db.financialAccount.findFirst({
              where: { plaidAccountId: balance.account_id },
              select: { id: true },
            });
            if (!account) continue;
            const effectiveAt = new Date();
            await db.$transaction([
              db.financialAccount.update({
                where: { id: account.id },
                data: {
                  currentBalance: balance.balances.current ?? 0,
                  availableBalance: balance.balances.available ?? null,
                  lastSyncedAt: effectiveAt,
                },
              }),
              db.accountBalanceSnapshot.create({
                data: {
                  accountId: account.id,
                  balance: balance.balances.current ?? 0,
                  availableBalance: balance.balances.available ?? null,
                  currency: balance.balances.iso_currency_code || 'USD',
                  effectiveAt,
                  source: 'PLAID_WEBHOOK',
                },
              }),
            ]);
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
      if (body.removed_transactions) {
        for (const externalId of body.removed_transactions) {
          await tombstonePlaidTransaction(externalId);
        }
        console.log(`Tombstoned ${body.removed_transactions.length} transactions`);
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
