import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSquareOAuthUrl } from '@/lib/square';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Generate a secure state parameter to prevent CSRF
    const state = crypto.randomBytes(32).toString('hex');

    // Get the redirect URI from request origin or env
    const origin = request.headers.get('origin') || process.env.NEXTAUTH_URL || '';
    const redirectUri = `${origin}/api/square/callback`;
    
    console.log('[Square Connect] Origin:', origin);
    console.log('[Square Connect] Redirect URI:', redirectUri);

    // Generate OAuth URL with explicit redirect URI
    const authUrl = getSquareOAuthUrl(state, redirectUri);
    
    console.log('[Square Connect] Generated auth URL:', authUrl);

    return NextResponse.json({
      authUrl,
      state, // Client should store this securely
    });
  } catch (error) {
    console.error('[Square Connect] Error initiating Square OAuth:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Square connection' },
      { status: 500 }
    );
  }
}
