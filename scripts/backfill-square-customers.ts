/**
 * Backfill Square customer + line-item enrichment onto transactions that were
 * synced before the enrichment code existed.
 *
 * For each Square income transaction that has a `metadata.customer_id` but no
 * linked `squareCustomerId`, resolve the customer via the Square API, upsert a
 * SquareCustomer, set merchantName + squareCustomerId. For each that has a
 * `metadata.order_id` but no line items, fetch the order and persist its lines.
 *
 * Dry-run by default; pass --apply to write. Usage:
 *   npm run square:backfill            # dry run
 *   npm run square:backfill:apply      # writes
 */
import { PrismaClient } from '@prisma/client';
import {
  bulkRetrieveSquareCustomers,
  batchGetSquareOrders,
  mapSquareOrderLineItems,
  squareCustomerDisplayName,
  refreshSquareToken,
  type SquareCustomerData,
} from '../src/lib/square';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function activeAccessToken(connection: {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}): Promise<string> {
  if (connection.expiresAt && new Date(connection.expiresAt) < new Date() && connection.refreshToken) {
    const refreshed = await refreshSquareToken(connection.refreshToken);
    const accessToken = refreshed.accessToken || connection.accessToken;
    if (APPLY) {
      await db.squareConnection.update({
        where: { id: connection.id },
        data: {
          accessToken,
          refreshToken: refreshed.refreshToken || connection.refreshToken,
          expiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt) : connection.expiresAt,
        },
      });
    }
    return accessToken;
  }
  return connection.accessToken;
}

async function main() {
  console.log(`Square backfill (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const connections = await db.squareConnection.findMany({
    include: { accounts: { select: { id: true } } },
  });

  let customersLinked = 0;
  let lineItemsAdded = 0;

  for (const connection of connections) {
    const accountIds = connection.accounts.map((a) => a.id);
    if (accountIds.length === 0) continue;

    const accessToken = await activeAccessToken(connection);

    // --- Customers ---
    const txnsNeedingCustomer = await db.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        squareCustomerId: null,
        type: 'INCOME',
      },
      select: { id: true, accountId: true, metadata: true },
    });

    const byCustomerId = new Map<string, string[]>(); // squareCustomerId -> txn ids
    for (const tx of txnsNeedingCustomer) {
      const cid = (tx.metadata as any)?.customer_id;
      if (!cid) continue;
      const list = byCustomerId.get(cid) ?? [];
      list.push(tx.id);
      byCustomerId.set(cid, list);
    }

    if (byCustomerId.size > 0) {
      console.log(`  [${connection.id}] ${byCustomerId.size} distinct customers to resolve`);
      let resolved = new Map<string, SquareCustomerData>();
      try {
        resolved = await bulkRetrieveSquareCustomers({
          accessToken,
          customerIds: Array.from(byCustomerId.keys()),
        });
      } catch (e) {
        console.log('  customer resolution failed (non-fatal):', e);
      }

      for (const [squareCustomerId, data] of Array.from(resolved.entries())) {
        const txIds = byCustomerId.get(squareCustomerId) ?? [];
        const displayName = squareCustomerDisplayName(data);
        if (!APPLY) {
          console.log(`    would link ${txIds.length} txns -> ${displayName ?? squareCustomerId}`);
          customersLinked += txIds.length;
          continue;
        }
        const row = await db.squareCustomer.upsert({
          where: {
            squareConnectionId_squareCustomerId: {
              squareConnectionId: connection.id,
              squareCustomerId,
            },
          },
          create: {
            userId: connection.userId,
            squareConnectionId: connection.id,
            squareCustomerId,
            name: data.name,
            email: data.email,
            phone: data.phone,
            companyName: data.companyName,
            firstSeen: data.createdAt ? new Date(data.createdAt) : null,
            lastSeen: new Date(),
          },
          update: {
            name: data.name,
            email: data.email,
            phone: data.phone,
            companyName: data.companyName,
            lastSeen: new Date(),
          },
          select: { id: true },
        });
        const res = await db.transaction.updateMany({
          where: { id: { in: txIds } },
          data: {
            squareCustomerId: row.id,
            ...(displayName ? { merchantName: displayName } : {}),
          },
        });
        customersLinked += res.count;
      }
    }

    // --- Line items ---
    const txnsNeedingItems = await db.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        type: 'INCOME',
        lineItems: { none: {} },
      },
      select: { id: true, metadata: true },
    });

    const orderIdToTxn = new Map<string, string>();
    for (const tx of txnsNeedingItems) {
      const orderId = (tx.metadata as any)?.order_id;
      if (orderId) orderIdToTxn.set(orderId, tx.id);
    }

    if (orderIdToTxn.size > 0) {
      console.log(`  [${connection.id}] ${orderIdToTxn.size} orders to backfill line items`);
      try {
        const { orders } = await batchGetSquareOrders({
          accessToken,
          orderIds: Array.from(orderIdToTxn.keys()),
        });
        for (const order of orders) {
          const txId = order?.id ? orderIdToTxn.get(order.id) : undefined;
          if (!txId) continue;
          const lines = mapSquareOrderLineItems(order);
          if (lines.length === 0) continue;
          if (!APPLY) {
            console.log(`    would add ${lines.length} line items to txn ${txId}`);
            lineItemsAdded += lines.length;
            continue;
          }
          for (const line of lines) {
            const data = {
              transactionId: txId,
              description: line.variationName ? `${line.name} (${line.variationName})` : line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              totalPrice: line.totalPrice,
              lineType: 'ITEM' as const,
              classification: 'INCOME' as const,
              sourceUid: line.uid,
            };
            if (line.uid) {
              await db.lineItem.upsert({
                where: { transactionId_sourceUid: { transactionId: txId, sourceUid: line.uid } },
                create: data,
                update: data,
              });
            } else {
              await db.lineItem.create({ data });
            }
            lineItemsAdded++;
          }
        }
      } catch (e) {
        console.log('  order line-item backfill failed (non-fatal):', e);
      }
    }
  }

  console.log(
    `\n${APPLY ? 'Linked' : 'Would link'} ${customersLinked} transactions to customers; ` +
      `${APPLY ? 'added' : 'would add'} ${lineItemsAdded} line items.`
  );
  if (!APPLY) console.log('Re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
