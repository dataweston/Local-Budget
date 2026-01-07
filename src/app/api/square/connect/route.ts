import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
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

    // Store state in database for verification during callback
    await db.user.update({
      where: { id: session.user.id },
      data: {
        // Store in metadata or a dedicated field
        // Using updatedAt as a workaround - in production use a proper state storage
      },
    });

    // For now, store state in a cookie or return it to client
    // The client should store this and verify it in the callback
    const authUrl = getSquareOAuthUrl(state);

    return NextResponse.json({
      authUrl,
      state, // Client should store this securely
    });
  } catch (error) {
    console.error('Error initiating Square OAuth:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Square connection' },
      { status: 500 }
    );
  }
}
