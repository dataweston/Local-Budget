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
  listSquarePayoutEntries,
  listSquarePayouts,
  mapSquarePayout,
  mapSquarePayoutEntry,
  squarePaymentExternalId,
  squareOrderExternalId,
  squarePayoutExternalId,
  squareRefundExternalId,
} from '@/lib/square';
import {
  resolveVendorId,
  createVendorResolverCache,
} from '@/lib/normalization/vendor-resolver';
import {
  refreshTransactionReconciliation,
  upsertTransactionSourceIdentity,
} from '@/lib/financial-integrity';
import {
  checkSettlementEntries,
  settlementBankDateWindow,
  settlementReconciliationStatus,
} from '@/lib/settlements';
import { matchBatchedSettlements } from '@/lib/settlement-matching';


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
        await db.transaction.update({
          where: { id: legacyExisting.id },
          data: { status: 'SUPERSEDED', removedAt: new Date() },
        });
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
      await upsertTransactionSourceIdentity(db, {
        transactionId: upsertedTx.id,
        sourceSystem: 'SQUARE',
        sourceAccountId: connection.id,
        externalId: mapped.id,
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
    // completed order is already counted by its payment. Preserve legacy order
    // rows as superseded provider history instead of deleting them.
    let orderDuplicatesRemoved = 0;
    if (paymentOrderIds.length > 0) {
      const duplicateOrderIds = paymentOrderIds.map((orderId) =>
        squareOrderExternalId(orderId)
      );
      const superseded = await db.transaction.updateMany({
        where: {
          accountId: account.id,
          externalId: { in: duplicateOrderIds },
          status: { not: 'SUPERSEDED' },
        },
        data: { status: 'SUPERSEDED', removedAt: new Date() },
      });
      orderDuplicatesRemoved = superseded.count;
      if (orderDuplicatesRemoved > 0) {
        console.log(
          `[Square Sync] Superseded ${orderDuplicatesRemoved} duplicate order transactions`
        );
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
          await db.transaction.update({
            where: { id: legacyExisting.id },
            data: { status: 'SUPERSEDED', removedAt: new Date() },
          });
        } else if (!canonicalExisting && legacyExisting) {
          await db.transaction.update({
            where: { id: legacyExisting.id },
            data: { externalId: canonicalExternalId },
          });
        }

        const txStatus =
          String(mapped.status).toUpperCase() === 'COMPLETED' ? 'POSTED' : 'PENDING';

        const storedRefund = await db.transaction.upsert({
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
        await upsertTransactionSourceIdentity(db, {
          transactionId: storedRefund.id,
          sourceSystem: 'SQUARE',
          sourceAccountId: connection.id,
          externalId: mapped.id,
        });

        if (isNew) added++;
      }
    } catch (refundError) {
      console.log('Error syncing refunds (non-fatal):', refundError);
    }

    // Sync payouts (bank transfers from Square to seller's bank account)
    let payoutsAdded = 0;
    try {
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
        const status = String(payout.status ?? '').toUpperCase();
        if (!['PAID', 'COMPLETED', 'SENT'].includes(status)) continue;

        const mapped = mapSquarePayout(payout);
        if (!mapped.id || !mapped.date) continue;
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
        const { entries: rawEntries } = await listSquarePayoutEntries({
          accessToken,
          payoutId: mapped.id,
          limit: 2000,
        });
        const entries = rawEntries.map(mapSquarePayoutEntry);
        const settlementAmount =
          Number(payout.amountMoney?.amount ?? Math.round(mapped.amount * 100)) / 100;
        const entryCheck = checkSettlementEntries(
          settlementAmount,
          entries.map((entry) => entry.netAmount)
        );
        const effectiveAt = new Date(payout.createdAt ?? mapped.date);
        const arrivalDate = payout.arrivalDate
          ? new Date(`${payout.arrivalDate}T00:00:00.000Z`)
          : null;
        const bankWindow = settlementBankDateWindow(arrivalDate ?? effectiveAt);
        // Match the payout to its bank deposit on amount + date window only.
        //
        // This deliberately does NOT filter on the descriptor containing
        // "square": the bank rarely names the processor. Measured against live
        // data, only 4 of 430 deposits into the settlement account mention
        // "square" at all — the rest post as a bare "Transfer in" — so a
        // descriptor requirement matched almost nothing and left every
        // settlement stuck at PARTIAL.
        //
        // Amount+date is specific enough on its own: 83 of 122 resolvable
        // payouts land on the exact anchor date and 14 more the next day, so
        // the existing [-2, +5] window is already the right shape (widening it
        // to [-5, +14] gained only 6). Ambiguity stays safe without the
        // descriptor: settlementReconciliationStatus() only reports MATCHED on
        // exactly one candidate, so a same-amount collision degrades to
        // PARTIAL for review rather than binding the wrong deposit.
        const bankCandidates = await db.transaction.findMany({
          where: {
            account: {
              userId: session.user.id,
              plaidAccountId: { not: null },
            },
            accountId: { not: account.id },
            status: 'POSTED',
            type: { in: ['INCOME', 'TRANSFER'] },
            amount: Math.abs(settlementAmount),
            date: { gte: bankWindow.from, lte: bankWindow.to },
          },
          select: { id: true, amount: true },
        });
        const reconciliationStatus = settlementReconciliationStatus({
          entryCount: entries.length,
          entriesBalanced: entryCheck.balanced,
          bankMatchCount: bankCandidates.length,
        });
        const referencedExternalIds = entries.flatMap((entry) => [
          ...(entry.paymentId ? [squarePaymentExternalId(entry.paymentId)] : []),
          ...(entry.refundId ? [squareRefundExternalId(entry.refundId)] : []),
        ]);
        const referencedTransactions = await db.transaction.findMany({
          where: {
            accountId: account.id,
            externalId: { in: referencedExternalIds },
          },
          select: { id: true, externalId: true },
        });
        const referencedByExternalId = new Map(
          referencedTransactions
            .filter((transaction) => !!transaction.externalId)
            .map((transaction) => [transaction.externalId!, transaction.id])
        );

        await db.$transaction(async (tx) => {
          const payoutTransaction = await tx.transaction.upsert({
            where: {
              accountId_externalId: {
                accountId: account.id,
                externalId,
              },
            },
            create: {
              accountId: account.id,
              amount: Math.abs(settlementAmount),
              type: 'TRANSFER',
              status: 'POSTED',
              date: effectiveAt,
              description: mapped.description,
              merchantName: 'Square Payout',
              externalId,
              isReviewed: false,
              metadata: { source: 'square', transferDirection: 'out', payoutId: mapped.id },
            },
            update: {
              amount: Math.abs(settlementAmount),
              type: 'TRANSFER',
              status: 'POSTED',
              removedAt: null,
              date: effectiveAt,
              description: mapped.description,
              merchantName: 'Square Payout',
              metadata: { source: 'square', transferDirection: 'out', payoutId: mapped.id },
            },
          });
          await upsertTransactionSourceIdentity(tx, {
            transactionId: payoutTransaction.id,
            sourceSystem: 'SQUARE',
            sourceAccountId: connection.id,
            externalId: mapped.id,
          });
          const settlement = await tx.processorSettlement.upsert({
            where: {
              accountId_provider_externalId: {
                accountId: account.id,
                provider: 'SQUARE',
                externalId: mapped.id,
              },
            },
            create: {
              accountId: account.id,
              transactionId: payoutTransaction.id,
              provider: 'SQUARE',
              externalId: mapped.id,
              status,
              amount: settlementAmount,
              currency: mapped.currency,
              effectiveAt,
              arrivalDate,
              reconciliationStatus,
              reconciledAt: reconciliationStatus === 'MATCHED' ? new Date() : null,
              metadata: {
                entryNetAmount: entryCheck.entryNetAmount,
                entryMismatchCents: entryCheck.mismatchCents,
                entryCount: entries.length,
                bankMatchCount: bankCandidates.length,
              },
            },
            update: {
              transactionId: payoutTransaction.id,
              status,
              amount: settlementAmount,
              currency: mapped.currency,
              effectiveAt,
              arrivalDate,
              reconciliationStatus,
              reconciledAt: reconciliationStatus === 'MATCHED' ? new Date() : null,
              metadata: {
                entryNetAmount: entryCheck.entryNetAmount,
                entryMismatchCents: entryCheck.mismatchCents,
                entryCount: entries.length,
                bankMatchCount: bankCandidates.length,
              },
            },
          });
          const currentEntryIds = entries.map((entry) => entry.id);
          const staleEntries = await tx.processorSettlementEntry.findMany({
            where: {
              settlementId: settlement.id,
              isCurrent: true,
              ...(currentEntryIds.length
                ? { providerEntryId: { notIn: currentEntryIds } }
                : {}),
            },
            select: {
              id: true,
              allocations: {
                where: { isCurrent: true },
                select: { id: true, transactionId: true },
              },
            },
          });
          if (staleEntries.length) {
            const removedAt = new Date();
            const staleEntryIds = staleEntries.map((entry) => entry.id);
            const staleAllocations = staleEntries.flatMap((entry) => entry.allocations);
            await tx.processorSettlementEntry.updateMany({
              where: { id: { in: staleEntryIds } },
              data: { isCurrent: false, removedAt },
            });
            if (staleAllocations.length) {
              await tx.reconciliationAllocation.updateMany({
                where: {
                  id: { in: staleAllocations.map((allocation) => allocation.id) },
                },
                data: { isCurrent: false, removedAt },
              });
              for (const transactionId of Array.from(
                new Set(staleAllocations.map((allocation) => allocation.transactionId))
              )) {
                await refreshTransactionReconciliation(tx, transactionId);
              }
            }
          }

          const retainedBankTransactionId =
            bankCandidates.length === 1 ? bankCandidates[0].id : null;
          const staleBankAllocations = await tx.reconciliationAllocation.findMany({
            where: {
              settlementId: settlement.id,
              role: 'BANK_SETTLEMENT',
              isCurrent: true,
              ...(retainedBankTransactionId
                ? { transactionId: { not: retainedBankTransactionId } }
                : {}),
            },
            select: { id: true, transactionId: true },
          });
          if (staleBankAllocations.length) {
            await tx.reconciliationAllocation.updateMany({
              where: {
                id: { in: staleBankAllocations.map((allocation) => allocation.id) },
              },
              data: { isCurrent: false, removedAt: new Date() },
            });
            for (const transactionId of Array.from(
              new Set(
                staleBankAllocations.map((allocation) => allocation.transactionId)
              )
            )) {
              await refreshTransactionReconciliation(tx, transactionId);
            }
          }

          await tx.reconciliationAllocation.upsert({
            where: {
              transactionId_externalSystem_externalObjectType_externalObjectId_role: {
                transactionId: payoutTransaction.id,
                externalSystem: 'SQUARE',
                externalObjectType: 'PAYOUT',
                externalObjectId: mapped.id,
                role: 'PROCESSOR_SETTLEMENT',
              },
            },
            create: {
              transactionId: payoutTransaction.id,
              userId: session.user.id,
              settlementId: settlement.id,
              externalSystem: 'SQUARE',
              externalObjectType: 'PAYOUT',
              externalObjectId: mapped.id,
              role: 'PROCESSOR_SETTLEMENT',
              amount: Math.abs(settlementAmount),
              currency: mapped.currency,
              method: 'IMPORTED',
              isCurrent: true,
              removedAt: null,
            },
            update: {
              settlementId: settlement.id,
              amount: Math.abs(settlementAmount),
              currency: mapped.currency,
              method: 'IMPORTED',
              isCurrent: true,
              removedAt: null,
            },
          });

          for (const entry of entries) {
            const storedEntry = await tx.processorSettlementEntry.upsert({
              where: {
                settlementId_providerEntryId: {
                  settlementId: settlement.id,
                  providerEntryId: entry.id,
                },
              },
              create: {
                settlementId: settlement.id,
                providerEntryId: entry.id,
                type: entry.type,
                effectiveAt: entry.effectiveAt ? new Date(entry.effectiveAt) : null,
                grossAmount: entry.grossAmount,
                feeAmount: entry.feeAmount,
                netAmount: entry.netAmount,
                currency: entry.currency,
                paymentExternalId: entry.paymentId,
                refundExternalId: entry.refundId,
                metadata: entry.metadata,
                isCurrent: true,
                removedAt: null,
              },
              update: {
                type: entry.type,
                effectiveAt: entry.effectiveAt ? new Date(entry.effectiveAt) : null,
                grossAmount: entry.grossAmount,
                feeAmount: entry.feeAmount,
                netAmount: entry.netAmount,
                currency: entry.currency,
                paymentExternalId: entry.paymentId,
                refundExternalId: entry.refundId,
                metadata: entry.metadata,
                isCurrent: true,
                removedAt: null,
              },
            });
            const referencedTransactionId = entry.paymentId
              ? referencedByExternalId.get(squarePaymentExternalId(entry.paymentId))
              : entry.refundId
                ? referencedByExternalId.get(squareRefundExternalId(entry.refundId))
                : undefined;
            const staleOriginAllocations =
              await tx.reconciliationAllocation.findMany({
                where: {
                  settlementEntryId: storedEntry.id,
                  role: 'ORIGINATING_ACTIVITY',
                  isCurrent: true,
                  ...(referencedTransactionId
                    ? { transactionId: { not: referencedTransactionId } }
                    : {}),
                },
                select: { id: true, transactionId: true },
              });
            if (staleOriginAllocations.length) {
              await tx.reconciliationAllocation.updateMany({
                where: {
                  id: {
                    in: staleOriginAllocations.map((allocation) => allocation.id),
                  },
                },
                data: { isCurrent: false, removedAt: new Date() },
              });
              for (const transactionId of Array.from(
                new Set(
                  staleOriginAllocations.map((allocation) => allocation.transactionId)
                )
              )) {
                await refreshTransactionReconciliation(tx, transactionId);
              }
            }
            if (!referencedTransactionId) continue;
            const allocationAmount = Math.abs(entry.grossAmount || entry.netAmount);
            await tx.reconciliationAllocation.upsert({
              where: {
                transactionId_externalSystem_externalObjectType_externalObjectId_role: {
                  transactionId: referencedTransactionId,
                  externalSystem: 'SQUARE',
                  externalObjectType: 'PAYOUT_ENTRY',
                  externalObjectId: entry.id,
                  role: 'ORIGINATING_ACTIVITY',
                },
              },
              create: {
                transactionId: referencedTransactionId,
                userId: session.user.id,
                settlementId: settlement.id,
                settlementEntryId: storedEntry.id,
                externalSystem: 'SQUARE',
                externalObjectType: 'PAYOUT_ENTRY',
                externalObjectId: entry.id,
                role: 'ORIGINATING_ACTIVITY',
                amount: allocationAmount,
                currency: entry.currency,
                method: 'IMPORTED',
                isCurrent: true,
                removedAt: null,
              },
              update: {
                settlementId: settlement.id,
                settlementEntryId: storedEntry.id,
                amount: allocationAmount,
                currency: entry.currency,
                method: 'IMPORTED',
                isCurrent: true,
                removedAt: null,
              },
            });
            await refreshTransactionReconciliation(tx, referencedTransactionId);
          }

          if (bankCandidates.length === 1) {
            const bankTransaction = bankCandidates[0];
            await tx.reconciliationAllocation.upsert({
              where: {
                transactionId_externalSystem_externalObjectType_externalObjectId_role: {
                  transactionId: bankTransaction.id,
                  externalSystem: 'SQUARE',
                  externalObjectType: 'PAYOUT',
                  externalObjectId: mapped.id,
                  role: 'BANK_SETTLEMENT',
                },
              },
              create: {
                transactionId: bankTransaction.id,
                userId: session.user.id,
                settlementId: settlement.id,
                externalSystem: 'SQUARE',
                externalObjectType: 'PAYOUT',
                externalObjectId: mapped.id,
                role: 'BANK_SETTLEMENT',
                amount: Math.abs(settlementAmount),
                currency: mapped.currency,
                method: 'AUTO',
                confidence: 0.95,
                isCurrent: true,
                removedAt: null,
              },
              update: {
                settlementId: settlement.id,
                amount: Math.abs(settlementAmount),
                currency: mapped.currency,
                method: 'AUTO',
                confidence: 0.95,
                isCurrent: true,
                removedAt: null,
              },
            });
            await refreshTransactionReconciliation(tx, bankTransaction.id);
          }
          await refreshTransactionReconciliation(tx, payoutTransaction.id);
        });

        if (!existing) payoutsAdded++;
      }
      console.log(`[Square Sync] Added ${payoutsAdded} new payouts`);

      // The per-payout matcher above only sees one payout at a time, so it
      // cannot resolve the days where Square batches several payouts into a
      // single deposit. Sweep those as a group now that every payout for the
      // window exists.
      const batched = await matchBatchedSettlements(db, session.user.id, account.id, {
        apply: true,
      });
      console.log(
        `[Square Sync] Batched settlement sweep: linked ${batched.linkedSettlements} payout(s) ` +
          `across ${batched.linkedDeposits} deposit(s); ${batched.ambiguousSettlements} ambiguous, ` +
          `${batched.unexplainedSettlements} unexplained`
      );
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
