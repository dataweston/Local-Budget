import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { removeItem } from '@/lib/plaid';
import { recordFinancialAudit } from '@/lib/financial-integrity';

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

    const disconnectedAt = new Date();
    const disconnectedAccounts = await db.$transaction(async (tx) => {
      const accounts = await tx.financialAccount.findMany({
        where: {
          userId: session.user.id,
          plaidItemId: plaidItem.itemId,
        },
      });
      await tx.financialAccount.updateMany({
        where: { id: { in: accounts.map((account) => account.id) } },
        data: { isActive: false },
      });
      await tx.plaidItem.update({
        where: { id: plaidItem.id },
        data: {
          status: 'disconnected',
          accessToken: '',
          cursor: null,
          errorCode: null,
        },
      });
      for (const account of accounts) {
        await recordFinancialAudit(tx, {
          userId: session.user.id,
          actorUserId: session.user.id,
          financialAccountId: account.id,
          action: 'PLAID_ACCOUNT_DISCONNECTED',
          source: 'MANUAL',
          reason: 'Plaid item disconnected by user',
          changedFields: ['isActive', 'plaidItem.status', 'plaidItem.accessToken'],
          before: {
            isActive: account.isActive,
            plaidItemStatus: plaidItem.status,
          },
          after: {
            isActive: false,
            plaidItemStatus: 'disconnected',
            disconnectedAt,
          },
        });
      }
      return accounts;
    });
    console.log(
      `[Plaid Disconnect] Deactivated ${disconnectedAccounts.length} account(s); financial history preserved`
    );

    return NextResponse.json({
      success: true,
      message: 'Plaid account disconnected. Existing financial history was preserved.',
    });
  } catch (error) {
    console.error('[Plaid Disconnect] Error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Plaid account' },
      { status: 500 }
    );
  }
}
