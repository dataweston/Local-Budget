import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';

// Plaid client configuration
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
      'PLAID-SECRET': process.env.PLAID_SECRET!,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

// Default products to request
export const PLAID_PRODUCTS: Products[] = [
  Products.Transactions,
  Products.Auth,
];

// Supported countries
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];

// Helper to create a link token for a user
export async function createLinkToken(userId: string, accessToken?: string) {
  const request = {
    user: {
      client_user_id: userId,
    },
    client_name: 'Local Budget',
    products: accessToken ? undefined : PLAID_PRODUCTS,
    country_codes: PLAID_COUNTRY_CODES,
    language: 'en',
    // Request 730 days (2 years) of transaction history on initial connect
    // This MUST be set during link token creation - cannot be changed after connection
    transactions: {
      days_requested: 730,
    },
    ...(accessToken && { access_token: accessToken }), // For update mode
  };

  const response = await plaidClient.linkTokenCreate(request);
  return response.data;
}

// Exchange public token for access token
export async function exchangePublicToken(publicToken: string) {
  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return response.data;
}

// Get account balances
export async function getAccountBalances(accessToken: string) {
  const response = await plaidClient.accountsBalanceGet({
    access_token: accessToken,
  });
  return response.data;
}

// Sync transactions using the new sync API
export async function syncTransactions(accessToken: string, cursor?: string) {
  const response = await plaidClient.transactionsSync({
    access_token: accessToken,
    cursor: cursor || undefined,
  });
  return response.data;
}

// Get transactions with explicit date range (for full historical fetch)
export async function getTransactions(
  accessToken: string, 
  startDate: string, 
  endDate: string,
  offset: number = 0
) {
  const response = await plaidClient.transactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
    options: {
      count: 500, // Max per request
      offset: offset,
    },
  });
  return response.data;
}

// Get all transactions for a date range (handles pagination)
export async function getAllTransactions(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const allTransactions: any[] = [];
  let offset = 0;
  let totalTransactions = 0;

  do {
    const response = await getTransactions(accessToken, startDate, endDate, offset);
    allTransactions.push(...response.transactions);
    totalTransactions = response.total_transactions;
    offset += response.transactions.length;
  } while (offset < totalTransactions);

  return allTransactions;
}

// Get institution info
export async function getInstitution(institutionId: string) {
  const response = await plaidClient.institutionsGetById({
    institution_id: institutionId,
    country_codes: PLAID_COUNTRY_CODES,
  });
  return response.data;
}

// Remove an item (unlink account)
export async function removeItem(accessToken: string) {
  const response = await plaidClient.itemRemove({
    access_token: accessToken,
  });
  return response.data;
}

// Types for our application
export interface PlaidTransactionData {
  transactionId: string;
  accountId: string;
  amount: number;
  date: string;
  name: string;
  merchantName?: string;
  category?: string[];
  pending: boolean;
}

// Map Plaid transaction to our format
export function mapPlaidTransaction(transaction: any): PlaidTransactionData {
  return {
    transactionId: transaction.transaction_id,
    accountId: transaction.account_id,
    amount: transaction.amount,
    date: transaction.date,
    name: transaction.name,
    merchantName: transaction.merchant_name || undefined,
    category: transaction.category || undefined,
    pending: transaction.pending,
  };
}
