import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { unstable_noStore as noStore } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { exchangeSquareAuthCode, getSquareBalance, getSquareBankAccounts } from '@/lib/square';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  noStore(); // Ensure dynamic rendering
  
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      // Redirect to login with return URL
      return NextResponse.redirect(new URL('/login?callbackUrl=/api/square/callback', request.url));
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      console.error('Square OAuth error:', error);
      return NextResponse.redirect(new URL('/accounts?error=square_denied', request.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/accounts?error=no_code', request.url));
    }

    // TODO: Verify state parameter against stored value

    // Exchange authorization code for access token
    const tokenResponse = await exchangeSquareAuthCode(code);

    if (!tokenResponse.accessToken) {
      return NextResponse.redirect(new URL('/accounts?error=token_failed', request.url));
    }

    // Get merchant info from locations
    const locations = await getSquareBalance(tokenResponse.accessToken);
    const merchantName = locations[0]?.name || 'Square Account';

    // Get or create default entity for the user
    let defaultEntity = await db.entity.findFirst({
      where: { userId: session.user.id, isDefault: true },
    });

    if (!defaultEntity) {
      defaultEntity = await db.entity.create({
        data: {
          userId: session.user.id,
          type: 'BUSINESS',
          name: String(merchantName),
          isDefault: true,
        },
      });
    }

    // Create Square connection record
    const squareConnection = await db.squareConnection.create({
      data: {
        userId: session.user.id,
        merchantId: tokenResponse.merchantId || undefined,
        accessToken: tokenResponse.accessToken, // In production, encrypt this!
        refreshToken: tokenResponse.refreshToken || undefined,
        expiresAt: tokenResponse.expiresAt ? new Date(tokenResponse.expiresAt) : undefined,
        locationIds: locations.map(l => l.locationId).filter(Boolean) as string[],
        status: 'active',
      },
    });

    // Create a financial account for Square balance
    const squareAccount = await db.financialAccount.create({
      data: {
        userId: session.user.id,
        entityId: defaultEntity.id,
        name: `${merchantName} - Square`,
        type: 'CHECKING', // Square balance acts like a checking account
        institution: 'Square',
        currency: locations[0]?.currency || 'USD',
        currentBalance: 0, // Will be updated on sync
        isActive: true,
        squareConnectionId: squareConnection.id,
        providerData: {
          provider: 'square',
        },
      },
    });

    // Try to get linked bank accounts from Square
    try {
      const bankAccounts = await getSquareBankAccounts(tokenResponse.accessToken);
      
      for (const bankAccount of bankAccounts) {
        await db.financialAccount.create({
          data: {
            userId: session.user.id,
            entityId: defaultEntity.id,
            name: `Bank Account (via Square)`,
            type: 'CHECKING',
            institution: 'Square Bank Account',
            accountNumber: bankAccount.accountNumberSuffix || undefined,
            currency: 'USD',
            currentBalance: 0,
            isActive: true,
            squareConnectionId: squareConnection.id,
            providerData: {
              provider: 'square_bank',
              squareBankAccountId: bankAccount.id,
              parentSquareAccountId: squareAccount.id,
            },
          },
        });
      }
    } catch (bankError) {
      console.log('No bank accounts linked to Square or error fetching:', bankError);
    }

    // Redirect to accounts page with success message
    return NextResponse.redirect(new URL('/accounts?connected=square', request.url));
  } catch (error) {
    console.error('Error in Square callback:', error);
    return NextResponse.redirect(new URL('/accounts?error=callback_failed', request.url));
  }
}
