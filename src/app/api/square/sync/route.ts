import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  listSquarePayments,
  listSquareRefunds,
  batchGetSquareOrders,
  bulkRetrieveSquareCustomers,
  mapSquarePayment,
  mapSquareRefund,
  mapSquareOrderLineItems,
  mapSquareOrderAdjustments,
  squareCustomerDisplayName,
  refreshSquareToken,
  type SquareCustomerData,
} from '@/lib/square';
import {
  resolveVendorId,
  createVendorResolverCache,
} from '@/lib/normalization/vendor-resolver';

function squarePaymentExternalId(paymentId: string) {
  return `square_${paymentId}`;
}

function squareOrderExternalId(orderId: string) {
  return `square_order_${orderId}`;
}

function squarePayoutExternalId(payoutId: string) {
  return `square_payout_${payoutId}`;
}

function squareRefundExternalId(refundId: string) {
  return `square_refund_${refundId}`;
}

// Auto-generated split descriptions. Splits with these descriptions are owned
// by the sync (deleted + recreated each run); user-created splits are never
// touched.
const AUTO_SPLIT_DESCRIPTIONS = [
  'Square net sales',
  'Square tip',
  'Sales tax collected (Square)',
];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { accountId } = await request.json();
    
    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    // Get the Square account with its connection
    const account = await db.financialAccount.findFirst({
      where: {
        id: accountId,
        userId: session.user.id,
      },
      include: {
        squareConnection: true,
      },
    });

    if (!account || !account.squareConnection) {
      return NextResponse.json({ error: 'Square account not found' }, { status: 404 });
    }

    const connection = account.squareConnection;
    let accessToken = connection.accessToken;

    // Check if token is expired and refresh if needed
    if (connection.expiresAt && new Date(connection.expiresAt) < new Date()) {
      if (connection.refreshToken) {
        try {
          const refreshed = await refreshSquareToken(connection.refreshToken);
          accessToken = refreshed.accessToken || accessToken;

          // Update stored tokens
          await db.squareConnection.update({
            where: { id: connection.id },
            data: {
              accessToken: refreshed.accessToken || connection.accessToken,
              refreshToken: refreshed.refreshToken || connection.refreshToken,
              expiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt) : connection.expiresAt,
            },
          });
        } catch (refreshError) {
          console.error('Failed to refresh Square token:', refreshError);
          return NextResponse.json({ error: 'Square token expired, please reconnect' }, { status: 401 });
        }
      }
    }

    // Calculate date range (last 365 days for comprehensive history)
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    let added = 0;

    let feesAdded = 0;
    let itemsAdded = 0;
    const vendorCache = createVendorResolverCache();

    // Sync payments
    console.log('[Square Sync] Syncing payments from', startTime, 'to', endTime);
    const { payments } = await listSquarePayments({
      accessToken,
      beginTime: startTime,
      endTime,
      limit: 5000,
    });

    console.log(`[Square Sync] Found ${payments.length} payments from Square`);

    // Fetch the orders behind these payments so invoice and payment-link
    // sales carry their line items and sales channel instead of an opaque
    // "Square Payment xxxxxx" row.
    const orderById = new Map<string, any>();
    const paymentOrderIds = Array.from(
      new Set(
        payments
          .filter((p: any) => p.status === 'COMPLETED' && p.orderId)
          .map((p: any) => p.orderId as string)
      )
    );
    if (paymentOrderIds.length > 0) {
      try {
        const { orders } = await batchGetSquareOrders({ accessToken, orderIds: paymentOrderIds });
        for (const order of orders) {
          if (order?.id) orderById.set(order.id, order);
        }
      } catch (orderError) {
        console.log('[Square Sync] Order enrichment failed (non-fatal):', orderError);
      }
    }

    // Resolve customer ids to real profiles so revenue can be reported by
    // customer instead of an opaque id. Payments without a customer_id (guest
    // / quick sales) simply have no entry here — that's expected.
    const customerById = new Map<string, SquareCustomerData>();
    const customerRowIdBySquareId = new Map<string, string>();
    let customersResolved = 0;
    const paymentCustomerIds = Array.from(
      new Set(
        payments
          .filter((p: any) => p.status === 'COMPLETED' && p.customerId)
          .map((p: any) => p.customerId as string)
      )
    );
    if (paymentCustomerIds.length > 0) {
      try {
        const resolved = await bulkRetrieveSquareCustomers({
          accessToken,
          customerIds: paymentCustomerIds,
        });
        for (const [squareCustomerId, data] of Array.from(resolved.entries())) {
          customerById.set(squareCustomerId, data);
          const row = await db.squareCustomer.upsert({
            where: {
              squareConnectionId_squareCustomerId: {
                squareConnectionId: connection.id,
                squareCustomerId,
              },
            },
            create: {
              userId: account.userId,
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
          customerRowIdBySquareId.set(squareCustomerId, row.id);
          customersResolved++;
        }
      } catch (customerError) {
        console.log('[Square Sync] Customer resolution failed (non-fatal):', customerError);
      }
    }

    for (const payment of payments) {
      if (payment.status !== 'COMPLETED') continue;

      const mapped = mapSquarePayment(payment);
      const order = mapped.orderId ? orderById.get(mapped.orderId) : undefined;
      const orderSource: string | undefined = order?.source?.name;
      const lineItemSummary: string | undefined = order?.lineItems
        ?.map((item: any) => item?.name)
        .filter(Boolean)
        .join(', ');

      // Sales channel: invoices set the order source to "Invoices"; payment
      // links and Square Online set their own source names.
      const channel = orderSource
        ? /invoice/i.test(orderSource)
          ? 'invoice'
          : 'payment_link'
        : 'pos_or_other';

      const description =
        payment.note ||
        lineItemSummary ||
        mapped.description;

      const customer = mapped.customerId ? customerById.get(mapped.customerId) : undefined;
      const customerRowId = mapped.customerId
        ? customerRowIdBySquareId.get(mapped.customerId) ?? null
        : null;
      // merchantName drives vendor/customer rollups. Prefer the resolved
      // customer name; fall back to the buyer email, then the sales channel —
      // anything but the old constant "Square Payment".
      const merchantName =
        (customer && squareCustomerDisplayName(customer)) ||
        mapped.buyerEmail ||
        (channel === 'invoice'
          ? 'Square Invoice'
          : channel === 'payment_link'
          ? 'Square Online'
          : 'Square Payment');

      // Money decomposition: the transaction records total collected (base +
      // tip); tax comes from the order. Tip and tax are broken out as splits
      // below so the P&L reads net sales, not tax-inclusive gross.
      const tipAmount = mapped.tipAmount ?? 0;
      const taxAmount = order ? Number(order?.totalTaxMoney?.amount ?? 0) / 100 : 0;
      const totalAmount = mapped.totalAmount ?? mapped.amount;

      const paymentMetadata = {
        source: 'square',
        channel,
        source_type: mapped.sourceType ?? null,
        order_id: mapped.orderId ?? null,
        order_source: orderSource ?? null,
        customer_id: mapped.customerId ?? null,
        customer_name: (customer && squareCustomerDisplayName(customer)) ?? null,
        receipt_number: mapped.receiptNumber ?? null,
        buyer_email: mapped.buyerEmail ?? null,
        base_amount: mapped.amount,
        tip_amount: tipAmount,
        sales_tax_amount: taxAmount,
        total_amount: totalAmount,
      };

      const vendorId = await resolveVendorId(db, merchantName, vendorCache);

      const canonicalExternalId = squarePaymentExternalId(mapped.id);
      const legacyExternalId = mapped.id;

      // Clean up legacy IDs that were written by the webhook (payment.id)
      const existingRecords = await db.transaction.findMany({
        where: {
          accountId: account.id,
          OR: [
            { externalId: canonicalExternalId },
            { externalId: legacyExternalId },
          ],
        },
        select: { id: true, externalId: true },
      });

      const canonicalExisting = existingRecords.find(
        (t) => t.externalId === canonicalExternalId
      );
      const legacyExisting = existingRecords.find(
        (t) => t.externalId === legacyExternalId
      );

      const isNew = !canonicalExisting && !legacyExisting;

      if (canonicalExisting && legacyExisting) {
        await db.transaction.delete({ where: { id: legacyExisting.id } });
      } else if (!canonicalExisting && legacyExisting) {
        await db.transaction.update({
          where: { id: legacyExisting.id },
          data: { externalId: canonicalExternalId },
        });
      }
      
      const upsertedTx = await db.transaction.upsert({
        where: {
          accountId_externalId: {
            accountId: account.id,
            externalId: canonicalExternalId,
          },
        },
        create: {
          accountId: account.id,
          amount: totalAmount,
          type: 'INCOME',
          status: 'POSTED',
          date: new Date(mapped.date),
          description,
          merchantName,
          squareCustomerId: customerRowId,
          vendorId,
          externalId: canonicalExternalId,
          isReviewed: false,
          metadata: paymentMetadata,
        },
        update: {
          amount: totalAmount,
          type: 'INCOME',
          status: 'POSTED',
          date: new Date(mapped.date),
          description,
          merchantName,
          squareCustomerId: customerRowId,
          vendorId,
          metadata: paymentMetadata,
        },
        select: { id: true },
      });

      if (isNew) added++;

      // Break tip and sales tax out of the recorded total via auto-splits so
      // the P&L counts net sales + tip as income and excludes collected tax
      // (a pass-through owed to the state, classified TRANSFER; the tax
      // report reads these splits). Idempotent: our splits are identified by
      // description and rebuilt each sync; user splits are untouched.
      await db.transactionSplit.deleteMany({
        where: {
          transactionId: upsertedTx.id,
          description: { in: AUTO_SPLIT_DESCRIPTIONS },
        },
      });
      if (tipAmount > 0 || taxAmount > 0) {
        const netSales = Math.max(totalAmount - tipAmount - taxAmount, 0);
        const splitData = [];
        if (netSales > 0) {
          splitData.push({
            transactionId: upsertedTx.id,
            amount: netSales,
            classification: 'INCOME' as const,
            description: 'Square net sales',
          });
        }
        if (tipAmount > 0) {
          splitData.push({
            transactionId: upsertedTx.id,
            amount: tipAmount,
            classification: 'INCOME' as const,
            description: 'Square tip',
          });
        }
        if (taxAmount > 0) {
          splitData.push({
            transactionId: upsertedTx.id,
            amount: taxAmount,
            classification: 'TRANSFER' as const,
            description: 'Sales tax collected (Square)',
          });
        }
        if (splitData.length > 0) {
          await db.transactionSplit.createMany({ data: splitData });
        }
      }

      // Persist order line items so revenue is reportable per item. Idempotent
      // via the (transactionId, sourceUid) unique key; lines without a stable
      // uid are re-created each sync (cleared first) to avoid duplicates.
      if (order) {
        const orderLines = mapSquareOrderLineItems(order);
        if (orderLines.length > 0) {
          await db.lineItem.deleteMany({
            where: { transactionId: upsertedTx.id, sourceUid: null },
          });
          for (const line of orderLines) {
            const data = {
              transactionId: upsertedTx.id,
              description: line.variationName
                ? `${line.name} (${line.variationName})`
                : line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              totalPrice: line.totalPrice,
              lineType: 'ITEM' as const,
              classification: 'INCOME' as const,
              sourceUid: line.uid,
            };
            if (line.uid) {
              await db.lineItem.upsert({
                where: {
                  transactionId_sourceUid: {
                    transactionId: upsertedTx.id,
                    sourceUid: line.uid,
                  },
                },
                create: data,
                update: data,
              });
            } else {
              await db.lineItem.create({ data });
            }
          }
          itemsAdded += orderLines.length;
        }

        // Order-level adjustments (sales tax, discounts, service charges) as
        // typed lines. Stable uids ('order:tax', …) make re-syncs idempotent.
        const adjustments = mapSquareOrderAdjustments(order);
        for (const adj of adjustments) {
          const data = {
            transactionId: upsertedTx.id,
            description: adj.description,
            totalPrice: adj.amount,
            lineType: adj.lineType,
            sourceUid: adj.uid,
          };
          await db.lineItem.upsert({
            where: {
              transactionId_sourceUid: {
                transactionId: upsertedTx.id,
                sourceUid: adj.uid,
              },
            },
            create: data,
            update: data,
          });
        }
      }

      // Extract and sync processing fees as separate expense transactions
      if (payment.processingFee && Array.isArray(payment.processingFee)) {
        for (const fee of payment.processingFee) {
          const feeAmount = Number(fee.amountMoney?.amount || 0) / 100;
          if (feeAmount <= 0) continue;

          const feeExternalId = `square_fee_${payment.id}`;
          const existingFee = await db.transaction.findUnique({
            where: {
              accountId_externalId: {
                accountId: account.id,
                externalId: feeExternalId,
              },
            },
            select: { id: true },
          });

          // Processing fees are a business operating cost, never personal.
          const feeVendorId = await resolveVendorId(db, 'Square Fees', vendorCache);

          await db.transaction.upsert({
            where: {
              accountId_externalId: {
                accountId: account.id,
                externalId: feeExternalId,
              },
            },
            create: {
              accountId: account.id,
              amount: feeAmount,
              type: 'EXPENSE',
              status: 'POSTED',
              date: new Date(mapped.date),
              description: `Square Processing Fee (${fee.type || 'INITIAL'})`,
              merchantName: 'Square Fees',
              classification: 'OPERATING',
              vendorId: feeVendorId,
              externalId: feeExternalId,
              isReviewed: false,
            },
            update: {
              amount: feeAmount,
              type: 'EXPENSE',
              status: 'POSTED',
              date: new Date(mapped.date),
              description: `Square Processing Fee (${fee.type || 'INITIAL'})`,
              merchantName: 'Square Fees',
              vendorId: feeVendorId,
            },
          });

          if (!existingFee) feesAdded++;
        }
      }
    }

    // Orders are no longer written as their own INCOME transactions: every
    // completed order is already counted by its payment, so the old
    // syncOrders path double-counted revenue. Orders now only enrich payment
    // descriptions/metadata (above). Remove any leftover duplicates from
    // earlier syncs for orders we know are covered by a payment.
    let orderDuplicatesRemoved = 0;
    if (paymentOrderIds.length > 0) {
      const duplicateOrderIds = paymentOrderIds.map((orderId) => squareOrderExternalId(orderId));
      const removed = await db.transaction.deleteMany({
        where: {
          accountId: account.id,
          externalId: { in: duplicateOrderIds },
        },
      });
      orderDuplicatesRemoved = removed.count;
      if (orderDuplicatesRemoved > 0) {
        console.log(`[Square Sync] Removed ${orderDuplicatesRemoved} duplicate order transactions`);
      }
    }

    // Sync refunds (outflows)
    try {
      const { refunds } = await listSquareRefunds({
        accessToken,
        beginTime: startTime,
        endTime,
        limit: 500,
      });

      console.log(`[Square Sync] Found ${refunds.length} refunds from Square`);

      for (const refund of refunds) {
        const mapped = mapSquareRefund(refund);
        if (!mapped.id || !mapped.date) continue;

        const canonicalExternalId = squareRefundExternalId(mapped.id);
        const legacyExternalId = `refund_${mapped.id}`;

        const existingRecords = await db.transaction.findMany({
          where: {
            accountId: account.id,
            OR: [
              { externalId: canonicalExternalId },
              { externalId: legacyExternalId },
            ],
          },
          select: { id: true, externalId: true },
        });

        const canonicalExisting = existingRecords.find(
          (t) => t.externalId === canonicalExternalId
        );
        const legacyExisting = existingRecords.find(
          (t) => t.externalId === legacyExternalId
        );

        const isNew = !canonicalExisting && !legacyExisting;

        if (canonicalExisting && legacyExisting) {
          await db.transaction.delete({ where: { id: legacyExisting.id } });
        } else if (!canonicalExisting && legacyExisting) {
          await db.transaction.update({
            where: { id: legacyExisting.id },
            data: { externalId: canonicalExternalId },
          });
        }

        const txStatus =
          String(mapped.status).toUpperCase() === 'COMPLETED' ? 'POSTED' : 'PENDING';

        await db.transaction.upsert({
          where: {
            accountId_externalId: {
              accountId: account.id,
              externalId: canonicalExternalId,
            },
          },
          create: {
            accountId: account.id,
            amount: mapped.amount,
            // EXPENSE type + INCOME classification = contra-revenue: the P&L
            // nets refunds against sales instead of booking an expense (and
            // instead of the old behavior, where the null classification fell
            // through to PERSONAL).
            type: 'EXPENSE',
            classification: 'INCOME',
            status: txStatus,
            date: new Date(mapped.date),
            description: mapped.description,
            merchantName: 'Square Refund',
            externalId: canonicalExternalId,
            isReviewed: false,
          },
          update: {
            amount: mapped.amount,
            type: 'EXPENSE',
            status: txStatus,
            date: new Date(mapped.date),
            description: mapped.description,
            merchantName: 'Square Refund',
          },
        });

        if (isNew) added++;
      }
    } catch (refundError) {
      console.log('Error syncing refunds (non-fatal):', refundError);
    }

    // Sync payouts (bank transfers from Square to seller's bank account)
    let payoutsAdded = 0;
    try {
      const { listSquarePayouts, mapSquarePayout } = await import('@/lib/square');
      const { payouts } = await listSquarePayouts({
        accessToken,
        beginTime: startTime,
        endTime,
        limit: 200,
      });
      
      console.log(`[Square Sync] Found ${payouts.length} payouts from Square`);
      
      // Log all payout statuses for debugging
      const statusCounts: Record<string, number> = {};
      for (const payout of payouts) {
        const status = payout.status || 'UNKNOWN';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }
      console.log(`[Square Sync] Payout statuses:`, statusCounts);
      
      for (const payout of payouts) {
        // Sync completed payouts (PAID or COMPLETED status)
        const status = (payout.status || '').toUpperCase();
        if (status !== 'PAID' && status !== 'COMPLETED' && status !== 'SENT') {
          console.log(`[Square Sync] Skipping payout ${payout.id} with status: ${payout.status}`);
          continue;
        }
        
        const mapped = mapSquarePayout(payout);
        const externalId = squarePayoutExternalId(mapped.id);

        const existing = await db.transaction.findUnique({
          where: {
            accountId_externalId: {
              accountId: account.id,
              externalId,
            },
          },
          select: { id: true },
        });
        
        await db.transaction.upsert({
          where: {
            accountId_externalId: {
              accountId: account.id,
              externalId,
            },
          },
          create: {
            accountId: account.id,
            amount: mapped.amount,
            type: 'TRANSFER', // Payout = money moving from Square to bank, not true expense
            status: 'POSTED',
            date: new Date(mapped.date),
            description: mapped.description,
            merchantName: 'Square Payout',
            externalId,
            isReviewed: false,
          },
          update: {
            amount: mapped.amount,
            type: 'TRANSFER', // Payout = money moving from Square to bank, not true expense
            status: 'POSTED',
            date: new Date(mapped.date),
            description: mapped.description,
            merchantName: 'Square Payout',
          },
        });

        if (!existing) payoutsAdded++;
      }
      console.log(`[Square Sync] Added ${payoutsAdded} new payouts`);
    } catch (payoutError) {
      console.log('[Square Sync] Error syncing payouts (non-fatal):', payoutError);
    }

    // Backfill classifications on rows written by earlier sync versions:
    // fees were landing in PERSONAL via the null-classification fallback, and
    // refunds were inflating personal expenses instead of netting revenue.
    const [feeBackfill, refundBackfill] = await Promise.all([
      db.transaction.updateMany({
        where: {
          accountId: account.id,
          merchantName: 'Square Fees',
          classification: null,
        },
        data: { classification: 'OPERATING' },
      }),
      db.transaction.updateMany({
        where: {
          accountId: account.id,
          merchantName: 'Square Refund',
          type: 'EXPENSE',
          classification: null,
        },
        data: { classification: 'INCOME' },
      }),
    ]);
    if (feeBackfill.count > 0 || refundBackfill.count > 0) {
      console.log(
        `[Square Sync] Backfilled classifications: ${feeBackfill.count} fees -> OPERATING, ${refundBackfill.count} refunds -> contra-revenue`
      );
    }

    // Calculate total balance from all completed transactions
    const allTransactions = await db.transaction.findMany({
      where: { accountId: account.id, status: 'POSTED' },
      select: { amount: true, type: true },
    });
    
    const calculatedBalance = allTransactions.reduce((sum, tx) => {
      const amount = Number(tx.amount);
      return tx.type === 'INCOME' ? sum + amount : sum - amount;
    }, 0);

    // Update account balance and sync time
    await db.financialAccount.update({
      where: { id: account.id },
      data: { 
        lastSyncedAt: new Date(),
        currentBalance: calculatedBalance,
      },
    });

    await db.squareConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date() },
    });

    console.log(`[Square Sync] Complete: ${added} transactions added, ${feesAdded} processing fees added, ${payoutsAdded} payouts added, ${customersResolved} customers resolved, ${itemsAdded} line items`);

    return NextResponse.json({
      success: true,
      added,
      feesAdded,
      payoutsAdded,
      customersResolved,
      itemsAdded,
      orderDuplicatesRemoved,
      message: `Synced ${added} new transactions, ${feesAdded} processing fees, and ${payoutsAdded} payouts from Square${
        orderDuplicatesRemoved > 0 ? `; removed ${orderDuplicatesRemoved} duplicate order rows` : ''
      }`,
    });
  } catch (error) {
    console.error('[Square Sync] Error syncing Square transactions:', error);
    return NextResponse.json(
      { error: 'Failed to sync Square transactions' },
      { status: 500 }
    );
  }
}
