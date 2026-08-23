import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { unstable_noStore as noStore } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { exchangeSquareAuthCode, getSquareBalance } from '@/lib/square';
import { selectSquareProcessorLedgerAccount } from '@/lib/square-processor-ledger';
import { oauthStatesMatch } from '@/lib/oauth-state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectAndClearState(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.set('square_oauth_state', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/square/callback',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  noStore(); // Ensure dynamic rendering
  
  try {
    const session = await getServerSession(authOptions);
    console.log('[Square Callback] Session:', session?.user?.id ? 'authenticated' : 'not authenticated');
    
    if (!session?.user?.id) {
      // Redirect to login with return URL
      console.log('[Square Callback] No session, redirecting to login');
      return redirectAndClearState(request, '/login?callbackUrl=/api/square/callback');
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    
    const expectedState = request.cookies.get('square_oauth_state')?.value;
    if (!oauthStatesMatch(expectedState, state)) {
      console.error('[Square Callback] OAuth state verification failed');
      return redirectAndClearState(request, '/accounts?error=invalid_oauth_state');
    }

    if (error) {
      console.error('[Square Callback] OAuth error:', error);
      return redirectAndClearState(request, '/accounts?error=square_denied');
    }

    if (!code) {
      console.error('[Square Callback] No authorization code received');
      return redirectAndClearState(request, '/accounts?error=no_code');
    }

    console.log('[Square Callback] Exchanging code for token...');

    // Construct the redirect URI (must match what was used in the authorization request)
    const redirectUri = `${request.nextUrl.origin}/api/square/callback`;
    console.log('[Square Callback] Using redirect URI:', redirectUri);

    // Exchange authorization code for access token
    let tokenResponse;
    try {
      tokenResponse = await exchangeSquareAuthCode(code, redirectUri);
      console.log('[Square Callback] Token exchange successful, merchantId:', tokenResponse.merchantId);
    } catch (tokenError) {
      console.error('[Square Callback] Token exchange failed:', tokenError);
      return redirectAndClearState(request, '/accounts?error=token_exchange_failed');
    }

    if (!tokenResponse.accessToken) {
      console.error('[Square Callback] No access token in response');
      return redirectAndClearState(request, '/accounts?error=token_failed');
    }

    console.log('[Square Callback] Getting merchant locations...');
    // Get merchant info from locations
    const locations = await getSquareBalance(tokenResponse.accessToken);
    console.log('[Square Callback] Found', locations.length, 'locations');
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

    // Check if a Square connection already exists for this user/merchant
    const existingConnection = await db.squareConnection.findFirst({
      where: {
        userId: session.user.id,
        merchantId: tokenResponse.merchantId || undefined,
      },
    });

    let squareConnection;
    if (existingConnection) {
      // Update existing connection with new tokens
      console.log('[Square Callback] Updating existing connection:', existingConnection.id);
      squareConnection = await db.squareConnection.update({
        where: { id: existingConnection.id },
        data: {
          accessToken: tokenResponse.accessToken,
          refreshToken: tokenResponse.refreshToken || undefined,
          expiresAt: tokenResponse.expiresAt ? new Date(tokenResponse.expiresAt) : undefined,
          locationIds: locations.map(l => l.locationId).filter(Boolean) as string[],
          status: 'active',
        },
      });

      // A connection may have historical destination-bank placeholders. Only a
      // tagged processor-ledger account is allowed to receive Square activity.
      const linkedAccounts = await db.financialAccount.findMany({
        where: { squareConnectionId: squareConnection.id },
        select: { id: true, providerData: true },
      });
      const selected = selectSquareProcessorLedgerAccount(linkedAccounts);

      if (selected.account) {
        console.log('[Square Callback] Processor-ledger account already exists, redirecting to accounts');
        return redirectAndClearState(request, '/accounts?connected=square&updated=true');
      }

      if (linkedAccounts.length > 0) {
        console.warn(
          `[Square Callback] Existing Square accounts are ${selected.reason}; ` +
            'creating a tagged processor ledger without modifying historical accounts or rows.'
        );
      }
    } else {
      // Create new Square connection record
      console.log('[Square Callback] Creating new Square connection');
      squareConnection = await db.squareConnection.create({
        data: {
          userId: session.user.id,
          merchantId: tokenResponse.merchantId || undefined,
          accessToken: tokenResponse.accessToken,
          refreshToken: tokenResponse.refreshToken || undefined,
          expiresAt: tokenResponse.expiresAt ? new Date(tokenResponse.expiresAt) : undefined,
          locationIds: locations.map(l => l.locationId).filter(Boolean) as string[],
          status: 'active',
        },
      });
    }

    // Create a financial account for Square balance
    await db.financialAccount.create({
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
          role: 'processor_ledger',
        },
      },
    });

    // Do not create FinancialAccounts for Square payout destinations. Those
    // are bank accounts and must ingest their cash activity from their own
    // bank/Plaid feed; attaching them to this connection used to let each one
    // independently ingest a second copy of Square sales.

    // Redirect to accounts page with success message
    return redirectAndClearState(request, '/accounts?connected=square');
  } catch (error) {
    console.error('Error in Square callback:', error);
    return redirectAndClearState(request, '/accounts?error=callback_failed');
  }
}
