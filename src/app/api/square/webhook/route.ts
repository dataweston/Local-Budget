import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

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
    
    // In production, verify the webhook signature
    // You need to set SQUARE_WEBHOOK_SIGNATURE_KEY env variable
    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const notificationUrl = process.env.SQUARE_WEBHOOK_URL || '';
    const squareEnv = process.env.SQUARE_ENV || process.env.SQUARE_ENVIRONMENT;
    
    if (signatureKey && squareEnv !== 'sandbox') {
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
      include: { accounts: true, user: true },
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
  connection: { id: string; userId: string; accounts: { id: string }[] }
) {
  const payment = data.object as {
    id: string;
    status: string;
    amount_money?: { amount: number; currency: string };
    source_type?: string;
    created_at?: string;
    updated_at?: string;
    note?: string;
    receipt_number?: string;
    order_id?: string;
  } | undefined;

  if (!payment) {
    console.log('No payment object in webhook data');
    return;
  }

  // Find or use the first Square-connected account
  const account = connection.accounts[0];
  if (!account) {
    console.log('No account found for Square connection');
    return;
  }

  const amount = payment.amount_money?.amount ?? 0;
  const amountInDollars = amount / 100; // Square amounts are in cents

  // Check if transaction already exists
  const existing = await db.transaction.findFirst({
    where: {
      accountId: account.id,
      externalId: payment.id,
    },
  });

  const transactionData = {
    accountId: account.id,
    amount: amountInDollars,
    type: 'INCOME' as const, // Square payments are typically income
    status: mapSquareStatus(payment.status),
    date: new Date(payment.created_at || new Date()),
    description: payment.note || `Square Payment ${payment.receipt_number || payment.id}`,
    merchantName: 'Square',
    externalId: payment.id,
    metadata: {
      source: 'square',
      source_type: payment.source_type,
      order_id: payment.order_id,
      receipt_number: payment.receipt_number,
    },
  };

  if (existing) {
    if (eventType === 'payment.updated') {
      await db.transaction.update({
        where: { id: existing.id },
        data: transactionData,
      });
      console.log(`Updated Square payment ${payment.id}`);
    }
  } else {
    await db.transaction.create({
      data: transactionData,
    });
    console.log(`Created Square payment ${payment.id}`);
  }
}

async function handlePaymentCompleted(
  data: { type: string; id: string; object?: Record<string, unknown> },
  connection: { id: string; accounts: { id: string }[] }
) {
  const payment = data.object as { id: string } | undefined;
  if (!payment) return;

  // Update transaction status to POSTED
  for (const account of connection.accounts) {
    await db.transaction.updateMany({
      where: {
        accountId: account.id,
        externalId: payment.id,
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

  const account = connection.accounts[0];
  if (!account) return;

  const amount = refund.amount_money?.amount ?? 0;
  const amountInDollars = amount / 100;

  // Check if refund transaction already exists
  const existing = await db.transaction.findFirst({
    where: {
      accountId: account.id,
      externalId: `refund_${refund.id}`,
    },
  });

  if (!existing && eventType === 'refund.created') {
    await db.transaction.create({
      data: {
        accountId: account.id,
        amount: amountInDollars,
        type: 'EXPENSE', // Refunds are money going out
        status: mapSquareStatus(refund.status),
        date: new Date(refund.created_at || new Date()),
        description: refund.reason || `Square Refund for payment ${refund.payment_id}`,
        merchantName: 'Square Refund',
        externalId: `refund_${refund.id}`,
        metadata: {
          source: 'square',
          refund_id: refund.id,
          payment_id: refund.payment_id,
        },
      },
    });
    console.log(`Created refund transaction for ${refund.id}`);
  } else if (existing && eventType === 'refund.updated') {
    await db.transaction.update({
      where: { id: existing.id },
      data: {
        status: mapSquareStatus(refund.status),
      },
    });
    console.log(`Updated refund ${refund.id}`);
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
