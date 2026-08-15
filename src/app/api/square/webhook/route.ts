import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import {
  bulkRetrieveSquareCustomers,
  squareCustomerDisplayName,
  squarePaymentExternalId,
  squareRefundExternalId,
} from '@/lib/square';
import { upsertTransactionSourceIdentity } from '@/lib/financial-integrity';

/**
 * The single account that mirrors this Square connection's ledger.
 *
 * `accounts` is a list because the schema lets several accounts reference one
 * connection, but only one can be the processor ledger. De-duplication between
 * the webhook and the polling sync relies on both writing the same payment to
 * the same account: the guarding constraint is `@@unique([accountId,
 * externalId])`, which is scoped *per account*. If the two paths ever disagree
 * about the target, every payment silently becomes two rows and no constraint
 * catches it. So resolve deterministically — oldest account wins, matching the
 * ordered include above — and log loudly when the configuration is ambiguous
 * rather than letting row order decide.
 */
function resolveProcessorAccount<T extends { id: string }>(
  connection: { id: string; accounts: T[] }
): T | undefined {
  if (connection.accounts.length > 1) {
    console.error(
      `[Square Webhook] SquareConnection ${connection.id} has ${connection.accounts.length} ` +
        `linked accounts; only one can be the processor ledger. Using the oldest ` +
        `(${connection.accounts[0]?.id}). Unlink the extras — a mismatch with the sync ` +
        `target creates duplicate transactions that the unique constraint cannot catch.`
    );
  }
  return connection.accounts[0];
}

// Resolve a single Square customer id to a stored SquareCustomer row, using the
// connection's access token. Returns the row id + display name, or nulls if the
// id is absent or resolution fails (guest sales, transient API errors).
async function resolveWebhookCustomer(
  connection: { id: string; userId: string; accessToken: string },
  customerId: string | null | undefined
): Promise<{ rowId: string | null; displayName: string | null }> {
  if (!customerId) return { rowId: null, displayName: null };
  try {
    const resolved = await bulkRetrieveSquareCustomers({
      accessToken: connection.accessToken,
      customerIds: [customerId],
    });
    const data = resolved.get(customerId);
    if (!data) return { rowId: null, displayName: null };
    const row = await db.squareCustomer.upsert({
      where: {
        squareConnectionId_squareCustomerId: {
          squareConnectionId: connection.id,
          squareCustomerId: customerId,
        },
      },
      create: {
        userId: connection.userId,
        squareConnectionId: connection.id,
        squareCustomerId: customerId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        companyName: data.companyName,
        firstSeen: data.createdAt ? new Date(data.createdAt) : null,
        lastSeen: new Date(),
      },
      update: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        companyName: data.companyName,
        lastSeen: new Date(),
      },
      select: { id: true },
    });
    return { rowId: row.id, displayName: squareCustomerDisplayName(data) };
  } catch (error) {
    console.log('[Square Webhook] Customer resolution failed (non-fatal):', error);
    return { rowId: null, displayName: null };
  }
}


// Square webhook event types
interface SquareWebhookEvent {
  merchant_id: string;
  type: string;
  event_id: string;
  created_at: string;
  data: {
    type: string;
    id: string;
    object?: Record<string, unknown>;
  };
}

// Verify Square webhook signature
function verifySquareSignature(
  payload: string,
  signature: string,
  signatureKey: string,
  notificationUrl: string
): boolean {
  try {
    // Combine the notification URL and payload
    const combined = notificationUrl + payload;
    
    // Create HMAC-SHA256 hash
    const hmac = crypto.createHmac('sha256', signatureKey);
    hmac.update(combined);
    const expectedSignature = hmac.digest('base64');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    const signature = request.headers.get('x-square-hmacsha256-signature') || '';
    
    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const notificationUrl = process.env.SQUARE_WEBHOOK_URL || '';
    const squareEnv = process.env.SQUARE_ENV || process.env.SQUARE_ENVIRONMENT;

    // Fail closed outside sandbox: an unverified webhook can mutate financial data.
    if (squareEnv !== 'sandbox') {
      if (!signatureKey) {
        console.error('SQUARE_WEBHOOK_SIGNATURE_KEY is not set; rejecting webhook');
        return NextResponse.json({ error: 'Webhook verification not configured' }, { status: 503 });
      }
      const isValid = verifySquareSignature(payload, signature, signatureKey, notificationUrl);
      if (!isValid) {
        console.error('Invalid Square webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const event: SquareWebhookEvent = JSON.parse(payload);
    const { merchant_id, type, event_id, data } = event;

    console.log(`Square webhook received: ${type} (${event_id}) for merchant ${merchant_id}`);

    // Find the Square connection for this merchant
    const squareConnection = await db.squareConnection.findFirst({
      where: { merchantId: merchant_id },
      include: {
        // Deterministic order: resolveProcessorAccount() takes the oldest, and
        // an unordered include would let the target drift between calls.
        accounts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        user: true,
      },
    });

    if (!squareConnection) {
      console.error(`SquareConnection not found for merchant: ${merchant_id}`);
      // Return 200 to acknowledge receipt even if we don't have the connection
      return NextResponse.json({ received: true, processed: false });
    }

    // Handle different event types
    switch (type) {
      case 'payment.created':
      case 'payment.updated':
        await handlePaymentEvent(type, data, squareConnection);
        break;

      case 'payment.completed':
        await handlePaymentCompleted(data, squareConnection);
        break;

      case 'refund.created':
      case 'refund.updated':
        await handleRefundEvent(type, data, squareConnection);
        break;

      case 'order.created':
      case 'order.updated':
        await handleOrderEvent(type, data, squareConnection);
        break;

      case 'bank_account.created':
      case 'bank_account.disabled':
        await handleBankAccountEvent(type, data, squareConnection);
        break;

      case 'oauth.authorization.revoked':
        await handleOAuthRevoked(squareConnection);
        break;

      default:
        console.log(`Unhandled Square event type: ${type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Square webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handlePaymentEvent(
  eventType: string,
  data: { type: string; id: string; object?: Record<string, unknown> },
  connection: { id: string; userId: string; accessToken: string; accounts: { id: string }[] }
) {
  const payment = data.object as {
    id: string;
    status: string;
    amount_money?: { amount: number; currency: string };
    tip_money?: { amount: number };
    total_money?: { amount: number };
    source_type?: string;
    created_at?: string;
    updated_at?: string;
    note?: string;
    receipt_number?: string;
    order_id?: string;
    customer_id?: string;
    buyer_email_address?: string;
  } | undefined;

  if (!payment) {
    console.log('No payment object in webhook data');
    return;
  }

  const account = resolveProcessorAccount(connection);
  if (!account) {
    console.log('No account found for Square connection');
    return;
  }

  // amount_money excludes the tip; record total_money (base + tip) — the
  // cash that actually hit the Square balance. Matches the sync route.
  const baseAmount = (payment.amount_money?.amount ?? 0) / 100;
  const tipAmount = (payment.tip_money?.amount ?? 0) / 100;
  const amountInDollars =
    payment.total_money?.amount != null
      ? payment.total_money.amount / 100
      : baseAmount + tipAmount;

  const { rowId: customerRowId, displayName: customerName } =
    await resolveWebhookCustomer(connection, payment.customer_id);

  const canonicalExternalId = squarePaymentExternalId(payment.id);
  const legacyExternalId = payment.id;

  // Check if transaction already exists
  const existingRecords = await db.transaction.findMany({
    where: {
      accountId: account.id,
      OR: [{ externalId: canonicalExternalId }, { externalId: legacyExternalId }],
    },
    select: { id: true, externalId: true },
  });

  const canonicalExisting = existingRecords.find(
    (t) => t.externalId === canonicalExternalId
  );
  const legacyExisting = existingRecords.find(
    (t) => t.externalId === legacyExternalId
  );

  // Keep field shapes identical to the sync route so the same payment looks
  // the same regardless of which path recorded it first.
  const transactionData = {
    accountId: account.id,
    amount: amountInDollars,
    type: 'INCOME' as const, // Square payments are typically income
    status: mapSquareStatus(payment.status),
    date: new Date(payment.created_at || new Date()),
    description:
      payment.note ||
      (payment.buyer_email_address
        ? `Square payment from ${payment.buyer_email_address}`
        : `Square Payment ${payment.receipt_number || payment.id.slice(-6)}`),
    // Prefer the resolved customer name; fall back to buyer email, then a
    // generic label — never the old constant "Square Payment" when we know who.
    merchantName:
      customerName || payment.buyer_email_address || 'Square Payment',
    squareCustomerId: customerRowId,
    externalId: canonicalExternalId,
    metadata: {
      source: 'square',
      source_type: payment.source_type ?? null,
      order_id: payment.order_id ?? null,
      customer_id: payment.customer_id ?? null,
      customer_name: customerName ?? null,
      receipt_number: payment.receipt_number ?? null,
      buyer_email: payment.buyer_email_address ?? null,
      base_amount: baseAmount,
      tip_amount: tipAmount,
      total_amount: amountInDollars,
    },
  };

  if (canonicalExisting && legacyExisting) {
    await db.transaction.update({
      where: { id: legacyExisting.id },
      data: { status: 'SUPERSEDED', removedAt: new Date() },
    });
  }

  const target = canonicalExisting ?? legacyExisting;
  const stored = target
    ? await db.transaction.update({
        where: { id: target.id },
        data: transactionData,
      })
    : await db.transaction.create({ data: transactionData });
  await upsertTransactionSourceIdentity(db, {
    transactionId: stored.id,
    sourceSystem: 'SQUARE',
    sourceAccountId: connection.id,
    externalId: payment.id,
  });
  console.log(`${target ? 'Upserted' : 'Created'} Square payment ${payment.id}`);
}

async function handlePaymentCompleted(
  data: { type: string; id: string; object?: Record<string, unknown> },
  connection: { id: string; accounts: { id: string }[] }
) {
  const payment = data.object as { id: string } | undefined;
  if (!payment) return;

  const canonicalExternalId = squarePaymentExternalId(payment.id);
  const legacyExternalId = payment.id;

  // Update transaction status to POSTED
  for (const account of connection.accounts) {
    await db.transaction.updateMany({
      where: {
        accountId: account.id,
        OR: [{ externalId: canonicalExternalId }, { externalId: legacyExternalId }],
      },
      data: {
        status: 'POSTED',
      },
    });
  }
  console.log(`Payment ${payment.id} marked as completed`);
}

async function handleRefundEvent(
  eventType: string,
  data: { type: string; id: string; object?: Record<string, unknown> },
  connection: { id: string; userId: string; accounts: { id: string }[] }
) {
  const refund = data.object as {
    id: string;
    status: string;
    amount_money?: { amount: number };
    payment_id?: string;
    reason?: string;
    created_at?: string;
  } | undefined;

  if (!refund) return;

  const account = resolveProcessorAccount(connection);
  if (!account) return;

  const amount = refund.amount_money?.amount ?? 0;
  const amountInDollars = amount / 100;

  const canonicalExternalId = squareRefundExternalId(refund.id);
  const legacyExternalId = `refund_${refund.id}`;

  // Check if refund transaction already exists
  const existingRecords = await db.transaction.findMany({
    where: {
      accountId: account.id,
      OR: [{ externalId: canonicalExternalId }, { externalId: legacyExternalId }],
    },
    select: { id: true, externalId: true },
  });

  const canonicalExisting = existingRecords.find(
    (t) => t.externalId === canonicalExternalId
  );
  const legacyExisting = existingRecords.find(
    (t) => t.externalId === legacyExternalId
  );

  if (canonicalExisting && legacyExisting) {
    await db.transaction.update({
      where: { id: legacyExisting.id },
      data: { status: 'SUPERSEDED', removedAt: new Date() },
    });
  }

  const target = canonicalExisting ?? legacyExisting;

  const baseData = {
    accountId: account.id,
    amount: amountInDollars,
    // EXPENSE type + INCOME classification = contra-revenue (netted against
    // sales in the P&L), matching the sync route.
    type: 'EXPENSE' as const,
    classification: 'INCOME' as const,
    status: mapSquareStatus(refund.status),
    date: new Date(refund.created_at || new Date()),
    description: refund.reason || `Square Refund for payment ${refund.payment_id}`,
    merchantName: 'Square Refund',
    externalId: canonicalExternalId,
    metadata: {
      source: 'square',
      refund_id: refund.id,
      payment_id: refund.payment_id,
    },
  };

  let storedId: string | null = null;
  if (target) {
    const stored = await db.transaction.update({
      where: { id: target.id },
      data:
        eventType === 'refund.updated'
          ? {
              status: mapSquareStatus(refund.status),
              externalId: canonicalExternalId,
            }
          : baseData,
    });
    storedId = stored.id;
  } else if (eventType === 'refund.created') {
    const stored = await db.transaction.create({ data: baseData });
    storedId = stored.id;
  }
  if (storedId) {
    await upsertTransactionSourceIdentity(db, {
      transactionId: storedId,
      sourceSystem: 'SQUARE',
      sourceAccountId: connection.id,
      externalId: refund.id,
    });
  }
}

async function handleOrderEvent(
  eventType: string,
  data: { type: string; id: string; object?: Record<string, unknown> },
  connection: { id: string }
) {
  // Orders can be used for more detailed line-item tracking
  // For now, we just log them
  const order = data.object as { id: string } | undefined;
  console.log(`Square order ${eventType}: ${order?.id}`);
  
  // TODO: Implement order-based line item tracking if needed
}

async function handleBankAccountEvent(
  eventType: string,
  data: { type: string; id: string; object?: Record<string, unknown> },
  connection: { id: string; userId: string }
) {
  const bankAccount = data.object as {
    id: string;
    status?: string;
    bank_name?: string;
    holder_name?: string;
  } | undefined;

  if (!bankAccount) return;

  if (eventType === 'bank_account.created') {
    // A new bank account was linked in Square
    console.log(`New Square bank account linked: ${bankAccount.bank_name}`);
    // Could create a new FinancialAccount here if desired
  } else if (eventType === 'bank_account.disabled') {
    console.log(`Square bank account disabled: ${bankAccount.id}`);
    // Could mark the corresponding FinancialAccount as inactive
  }
}

async function handleOAuthRevoked(
  connection: { id: string }
) {
  // User revoked OAuth access - mark connection as inactive
  await db.squareConnection.update({
    where: { id: connection.id },
    data: { status: 'revoked' },
  });
  console.log(`Square OAuth access revoked for connection ${connection.id}`);
}

function mapSquareStatus(status: string): 'PENDING' | 'POSTED' | 'CANCELLED' {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
    case 'CAPTURED':
      return 'POSTED';
    case 'PENDING':
    case 'APPROVED':
      return 'PENDING';
    case 'CANCELED':
    case 'CANCELLED':
    case 'FAILED':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

// Handle GET requests (for webhook URL verification)
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'Square webhook endpoint active' });
}
