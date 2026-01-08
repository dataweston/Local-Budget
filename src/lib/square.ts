import { SquareClient, SquareEnvironment, SquareError } from 'square';

const squareEnv = process.env.SQUARE_ENV || process.env.SQUARE_ENVIRONMENT;
const isSquareProduction = squareEnv === 'production';
const squareAppId =
  process.env.SQUARE_APPLICATION_ID || process.env.SQUARE_APP_ID || '';
const squareAppSecret =
  process.env.SQUARE_APPLICATION_SECRET || process.env.SQUARE_APP_SECRET || '';

// Square client configuration (SDK v43+)
const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN || '',
  environment: isSquareProduction
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox,
});

export { squareClient };

// ============================================================================
// OAuth Flow Helpers
// ============================================================================

const SQUARE_OAUTH_URL = isSquareProduction
  ? 'https://connect.squareup.com/oauth2/authorize'
  : 'https://connect.squareupsandbox.com/oauth2/authorize';

// Generate OAuth authorization URL
export function getSquareOAuthUrl(state: string, redirectUri?: string) {
  if (!squareAppId) {
    throw new Error('Missing Square application id');
  }
  
  // Use provided redirectUri or construct from NEXTAUTH_URL
  const callbackUrl = redirectUri || `${process.env.NEXTAUTH_URL}/api/square/callback`;
  
  const params = new URLSearchParams({
    client_id: squareAppId,
    scope: [
      'PAYMENTS_READ',
      'PAYMENTS_WRITE',
      'ORDERS_READ',
      'ORDERS_WRITE',
      'PAYOUTS_READ', // For bank transfers/payouts
      'MERCHANT_PROFILE_READ',
      'BANK_ACCOUNTS_READ',
      'CUSTOMERS_READ',
      'ITEMS_READ',
    ].join(' '),
    state,
    session: 'false',
    redirect_uri: callbackUrl,
  });

  return `${SQUARE_OAUTH_URL}?${params.toString()}`;
}

// Exchange authorization code for access token
export async function exchangeSquareAuthCode(code: string) {
  if (!squareAppId || !squareAppSecret) {
    throw new Error('Missing Square application credentials');
  }
  const response = await squareClient.oAuth.obtainToken({
    clientId: squareAppId,
    clientSecret: squareAppSecret,
    grantType: 'authorization_code',
    code,
  });

  return response;
}

// Refresh an expired access token
export async function refreshSquareToken(refreshToken: string) {
  if (!squareAppId || !squareAppSecret) {
    throw new Error('Missing Square application credentials');
  }
  const response = await squareClient.oAuth.obtainToken({
    clientId: squareAppId,
    clientSecret: squareAppSecret,
    grantType: 'refresh_token',
    refreshToken,
  });

  return response;
}

// ============================================================================
// Banking & Balance Helpers
// ============================================================================

// Create a client with a specific access token (for OAuth users)
function createUserClient(accessToken: string) {
  return new SquareClient({
    token: accessToken,
    environment: isSquareProduction
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  });
}

// Get all linked bank accounts
export async function getSquareBankAccounts(accessToken?: string) {
  const client = accessToken ? createUserClient(accessToken) : squareClient;
  
  // SDK v43 returns a Page object with data property
  const page = await client.bankAccounts.list();
  const bankAccounts = page.data || [];
  
  return bankAccounts;
}

// Get Square balance (from locations and calculate from payments)
export async function getSquareBalance(accessToken?: string) {
  const client = accessToken ? createUserClient(accessToken) : squareClient;
  
  // Get all locations to aggregate balances
  const locationsResponse = await client.locations.list();
  const locations = locationsResponse.locations || [];
  
  // Calculate balance from recent payments per location
  const balances = await Promise.all(
    locations.map(async (location) => {
      try {
        // Get payments for this location (last 30 days)
        const paymentsPage = await client.payments.list({
          locationId: location.id,
          beginTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        
        const payments = paymentsPage.data || [];
        const totalAmount = payments
          .filter((p: any) => p.status === 'COMPLETED')
          .reduce((sum: number, p: any) => sum + Number(p.amountMoney?.amount || 0), 0);
        
        return {
          locationId: location.id,
          name: location.name,
          currency: location.currency || 'USD',
          balance: totalAmount / 100, // Convert from cents
        };
      } catch {
        return {
          locationId: location.id,
          name: location.name,
          currency: location.currency || 'USD',
          balance: 0,
        };
      }
    })
  );
  
  return balances;
}

// ============================================================================
// Transaction/Payment Helpers
// ============================================================================

// Payment type for internal use
interface SquarePaymentRecord {
  id?: string;
  locationId?: string;
  amountMoney?: { amount?: bigint; currency?: string };
  createdAt?: string;
  note?: string;
  status?: string;
  sourceType?: string;
  customerId?: string;
}

// List payments (transactions) with pagination
export async function listSquarePayments(options: {
  accessToken?: string;
  beginTime?: string;
  endTime?: string;
  locationId?: string;
  limit?: number;
}) {
  const client = options.accessToken ? createUserClient(options.accessToken) : squareClient;

  // SDK v43 returns a Page object with data property
  const page = await client.payments.list({
    beginTime: options.beginTime,
    endTime: options.endTime,
    locationId: options.locationId,
  });

  const payments = (page.data || []).slice(0, options.limit || 100);

  return { payments };
}

// List orders with items for detailed transaction info
export async function listSquareOrders(options: {
  accessToken?: string;
  locationIds: string[];
  limit?: number;
}) {
  const client = options.accessToken ? createUserClient(options.accessToken) : squareClient;

  const response = await client.orders.search({
    locationIds: options.locationIds,
    limit: options.limit || 100,
    query: {
      sort: {
        sortField: 'CREATED_AT',
        sortOrder: 'DESC',
      },
    },
  });

  return {
    orders: response.orders || [],
  };
}

// List payouts (bank transfers from Square to seller's bank account)
export async function listSquarePayouts(options: {
  accessToken?: string;
  locationId?: string;
  beginTime?: string;
  endTime?: string;
  limit?: number;
}) {
  const client = options.accessToken ? createUserClient(options.accessToken) : squareClient;

  const page = await client.payouts.list({
    locationId: options.locationId,
    beginTime: options.beginTime,
    endTime: options.endTime,
  });

  const payouts = (page.data || []).slice(0, options.limit || 100);

  return { payouts };
}

// List refunds (money flowing out of Square due to refunds)
export async function listSquareRefunds(options: {
  accessToken?: string;
  locationId?: string;
  beginTime?: string;
  endTime?: string;
  limit?: number;
}) {
  const client = options.accessToken ? createUserClient(options.accessToken) : squareClient;

  const page = await client.refunds.list({
    locationId: options.locationId,
    beginTime: options.beginTime,
    endTime: options.endTime,
  });

  const refunds = (page.data || []).slice(0, options.limit || 100);

  return { refunds };
}

// ============================================================================
// Type Mappings
// ============================================================================

export interface SquareTransactionData {
  id: string;
  locationId?: string;
  amount: number;
  currency: string;
  date: string;
  description: string;
  status: string;
  sourceType?: string;
  customerId?: string;
}

// Map Square payment to our format
export function mapSquarePayment(payment: any): SquareTransactionData {
  return {
    id: payment.id,
    locationId: payment.locationId,
    amount: Number(payment.amountMoney?.amount || 0) / 100, // Square uses cents
    currency: payment.amountMoney?.currency || 'USD',
    date: payment.createdAt,
    description: payment.note || `Square Payment ${payment.id.slice(-6)}`,
    status: payment.status,
    sourceType: payment.sourceType,
    customerId: payment.customerId,
  };
}

// Map Square order to our format
export function mapSquareOrder(order: any): SquareTransactionData {
  const totalMoney = order.totalMoney || { amount: 0, currency: 'USD' };
  return {
    id: order.id,
    locationId: order.locationId,
    amount: Number(totalMoney.amount || 0) / 100,
    currency: totalMoney.currency || 'USD',
    date: order.createdAt,
    description: order.lineItems?.map((item: any) => item.name).join(', ') || `Square Order ${order.id.slice(-6)}`,
    status: order.state,
  };
}

// Map Square payout (bank transfer) to our format
export function mapSquarePayout(payout: any): SquareTransactionData {
  const amountMoney = payout.amountMoney || { amount: 0, currency: 'USD' };
  const destination = payout.destination;
  const destType = destination?.type === 'CARD' ? 'Card' : 'Bank Account';
  return {
    id: payout.id,
    locationId: payout.locationId,
    amount: Math.abs(Number(amountMoney.amount || 0)) / 100, // Payouts can be negative for fees
    currency: amountMoney.currency || amountMoney.currencyCode || 'USD',
    date: payout.createdAt,
    description: `Payout to ${destType}${payout.arrivalDate ? ` (${payout.arrivalDate})` : ''}`,
    status: payout.status,
  };
}

// Map Square refund to our format
export function mapSquareRefund(refund: any): SquareTransactionData {
  const amountMoney = refund.amountMoney || { amount: 0, currency: 'USD' };
  const refundId = refund.id || '';
  const paymentId = refund.paymentId || refund.payment_id;

  return {
    id: refundId,
    locationId: refund.locationId || refund.location_id,
    amount: Math.abs(Number(amountMoney.amount || 0)) / 100,
    currency: amountMoney.currency || amountMoney.currencyCode || 'USD',
    date: refund.createdAt || refund.created_at,
    description:
      refund.reason ||
      (paymentId
        ? `Square Refund for payment ${String(paymentId).slice(-6)}`
        : `Square Refund ${String(refundId).slice(-6)}`),
    status: refund.status || 'UNKNOWN',
  };
}

// ============================================================================
// Error Handling
// ============================================================================

export function isSquareError(error: unknown): error is SquareError {
  return error instanceof SquareError;
}

export function formatSquareError(error: SquareError): string {
  const errors = error.errors || [];
  return errors.map((e: { category?: string; detail?: string }) => `${e.category}: ${e.detail}`).join('; ') || 'Unknown Square API error';
}
