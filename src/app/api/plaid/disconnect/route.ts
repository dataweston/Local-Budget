import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { removeItem } from '@/lib/plaid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { plaidItemId } = await request.json();

    if (!plaidItemId) {
      return NextResponse.json({ error: 'plaidItemId is required' }, { status: 400 });
    }

    console.log(`[Plaid Disconnect] Disconnecting Plaid item: ${plaidItemId}`);

    // Find the PlaidItem (using itemId which is Plaid's ID)
    const plaidItem = await db.plaidItem.findFirst({
      where: {
        itemId: plaidItemId,
        userId: session.user.id,
      },
    });

    if (!plaidItem) {
      return NextResponse.json({ error: 'Plaid item not found' }, { status: 404 });
    }

    // Remove the item from Plaid's servers
    try {
      await removeItem(plaidItem.accessToken);
      console.log(`[Plaid Disconnect] Successfully removed item from Plaid: ${plaidItemId}`);
    } catch (error) {
      // Log but don't fail - item might already be removed on Plaid's side
      console.error(`[Plaid Disconnect] Warning: Could not remove from Plaid API:`, error);
    }

    // Delete transactions associated with accounts linked to this Plaid item
    await db.transaction.deleteMany({
      where: {
        account: {
          plaidItemId: plaidItem.itemId,
        },
      },
    });
    console.log(`[Plaid Disconnect] Deleted associated transactions`);

    // Delete financial accounts linked to this Plaid item
    await db.financialAccount.deleteMany({
      where: {
        plaidItemId: plaidItem.itemId,
      },
    });
    console.log(`[Plaid Disconnect] Deleted associated financial accounts`);

    // Delete Plaid accounts (this should cascade, but let's be explicit)
    await db.plaidAccount.deleteMany({
      where: {
        plaidItemId: plaidItem.id,
      },
    });
    console.log(`[Plaid Disconnect] Deleted Plaid accounts`);

    // Delete the PlaidItem itself
    await db.plaidItem.delete({
      where: {
        id: plaidItem.id,
      },
    });
    console.log(`[Plaid Disconnect] Deleted PlaidItem from database`);

    return NextResponse.json({
      success: true,
      message: 'Plaid account disconnected. You can now reconnect to get full transaction history.',
    });
  } catch (error) {
    console.error('[Plaid Disconnect] Error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Plaid account' },
      { status: 500 }
    );
  }
}
