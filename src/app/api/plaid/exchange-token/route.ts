import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { exchangePublicToken, getAccountBalances, getInstitution } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { publicToken, metadata } = await request.json();

    if (!publicToken) {
      return NextResponse.json({ error: 'Public token is required' }, { status: 400 });
    }

    // Exchange public token for access token
    const exchangeResponse = await exchangePublicToken(publicToken);
    const { access_token, item_id } = exchangeResponse;

    // Get account balances and info
    const accountsResponse = await getAccountBalances(access_token);
    const accounts = accountsResponse.accounts;

    // Get institution info
    let institutionName = metadata?.institution?.name || 'Unknown Bank';
    if (metadata?.institution?.institution_id) {
      try {
        const instResponse = await getInstitution(metadata.institution.institution_id);
        institutionName = instResponse.institution.name;
      } catch {
        // Use metadata name as fallback
      }
    }

    // Store the Plaid item in database
    const plaidItem = await db.plaidItem.create({
      data: {
        userId: session.user.id,
        itemId: item_id,
        accessToken: access_token, // In production, encrypt this!
        institutionId: metadata?.institution?.institution_id,
        institutionName,
        status: 'ACTIVE',
      },
    });

    // Get or create default entity for the user
    let defaultEntity = await db.entity.findFirst({
      where: { userId: session.user.id, isDefault: true },
    });

    if (!defaultEntity) {
      defaultEntity = await db.entity.create({
        data: {
          userId: session.user.id,
          type: 'PERSON',
          name: 'Personal',
          isDefault: true,
        },
      });
    }

    // Create financial accounts for each Plaid account
    const createdAccounts = [];
    for (const account of accounts) {
      // Map Plaid account type to our type
      const accountType = mapPlaidAccountType(account.type, account.subtype);

      const financialAccount = await db.financialAccount.create({
        data: {
          userId: session.user.id,
          entityId: defaultEntity.id,
          name: account.name,
          type: accountType,
          institution: institutionName,
          accountNumber: account.mask || undefined,
          currentBalance: account.balances.current || 0,
          availableBalance: account.balances.available || undefined,
          currency: account.balances.iso_currency_code || 'USD',
          plaidAccountId: account.account_id,
          plaidItemId: plaidItem.itemId, // Use itemId, not id
          lastSyncedAt: new Date(),
        },
      });

      // Also store in PlaidAccount for reference
      await db.plaidAccount.create({
        data: {
          plaidItemId: plaidItem.id, // Use id here (refers to PlaidItem.id)
          accountId: account.account_id,
          name: account.name,
          mask: account.mask,
          type: account.type,
          subtype: account.subtype || undefined,
          financialAccountId: financialAccount.id,
        },
      });

      createdAccounts.push(financialAccount);
    }

    return NextResponse.json({
      success: true,
      itemId: plaidItem.id,
      accounts: createdAccounts.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        balance: a.currentBalance,
      })),
    });
  } catch (error) {
    console.error('Error exchanging token:', error);
    return NextResponse.json(
      { error: 'Failed to link account' },
      { status: 500 }
    );
  }
}

// Map Plaid account types to our AccountType enum
function mapPlaidAccountType(type: string, subtype?: string | null): 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'CASH' | 'INVESTMENT' | 'LOAN' | 'OTHER' {
  const t = type?.toLowerCase();
  const st = subtype?.toLowerCase();

  if (t === 'depository') {
    if (st === 'checking') return 'CHECKING';
    if (st === 'savings') return 'SAVINGS';
    return 'CHECKING';
  }
  if (t === 'credit') return 'CREDIT_CARD';
  if (t === 'investment' || t === 'brokerage') return 'INVESTMENT';
  if (t === 'loan' || t === 'mortgage') return 'LOAN';
  
  return 'OTHER';
}
