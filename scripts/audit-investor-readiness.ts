/**
 * Read-only, aggregate-only audit of Local Budget's live finance data.
 *
 * This script intentionally emits no transaction descriptions, customer names,
 * account numbers, tokens, or source payloads. It is safe to attach to an
 * internal audit packet and makes no database mutations.
 *
 * Run:
 *   pnpm exec tsx scripts/audit-investor-readiness.ts
 */

import './load-env';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const CENT = 100;
const cent = (value: unknown) => Math.round(Math.abs(Number(value ?? 0)) * CENT);
const dollars = (value: number) => Number((value / CENT).toFixed(2));
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const month = (value: Date) => value.toISOString().slice(0, 7);

type Tx = Awaited<ReturnType<typeof loadTransactions>>[number];
type EffectiveClassification =
  | 'COGS'
  | 'OPERATING'
  | 'PERSONAL'
  | 'INCOME'
  | 'TRANSFER'
  | 'REIMBURSABLE'
  | 'REIMBURSEMENT'
  | 'UNCLASSIFIED';

function effectiveClassification(input: {
  type: string;
  classification: string | null;
  category: { defaultClassification: string | null } | null;
}): EffectiveClassification {
  if (input.classification) return input.classification as EffectiveClassification;
  if (input.category?.defaultClassification) {
    return input.category.defaultClassification as EffectiveClassification;
  }
  if (input.type === 'INCOME') return 'INCOME';
  if (input.type === 'TRANSFER') return 'TRANSFER';
  return 'UNCLASSIFIED';
}

function aggregateMoney<K extends string>(rows: Array<[K, number]>) {
  const out: Record<string, number> = {};
  for (const [key, amount] of rows) out[key] = (out[key] ?? 0) + amount;
  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, amount]) => [key, dollars(amount as number)])
  );
}

function sumCents(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

async function loadTransactions() {
  return db.transaction.findMany({
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      status: true,
      date: true,
      description: true,
      merchantName: true,
      externalId: true,
      classification: true,
      categoryId: true,
      payerId: true,
      incurredById: true,
      createdAt: true,
      updatedAt: true,
      account: {
        select: {
          name: true,
          type: true,
          entityId: true,
          squareConnectionId: true,
          plaidAccountId: true,
        },
      },
      category: { select: { name: true, defaultClassification: true } },
      splits: {
        select: {
          amount: true,
          classification: true,
          incurredById: true,
          category: { select: { name: true, defaultClassification: true } },
        },
      },
      allocations: {
        where: { isCurrent: true },
        select: { role: true, amount: true, settlementId: true },
      },
      receiptLinks: { select: { id: true } },
      auditEvents: { select: { id: true, action: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
}

function pnlFor(transactions: Tx[]) {
  const totals: Record<EffectiveClassification | 'REFUNDS', number> = {
    COGS: 0,
    OPERATING: 0,
    PERSONAL: 0,
    INCOME: 0,
    TRANSFER: 0,
    REIMBURSABLE: 0,
    REIMBURSEMENT: 0,
    UNCLASSIFIED: 0,
    REFUNDS: 0,
  };
  let transactionCount = 0;
  let lineCount = 0;
  for (const tx of transactions) {
    if (tx.status !== 'POSTED') continue;
    if (tx.allocations.some((allocation) => allocation.role === 'BANK_SETTLEMENT')) continue;
    transactionCount += 1;
    const parentClassification = effectiveClassification(tx);
    const lines = tx.splits.length ? tx.splits : [tx];
    for (const line of lines) {
      lineCount += 1;
      const classification = (line.classification ??
        line.category?.defaultClassification ??
        parentClassification) as EffectiveClassification;
      const amount = cent(line.amount);
      if (classification === 'INCOME' && tx.type === 'EXPENSE') totals.REFUNDS += amount;
      else totals[classification] += amount;
    }
  }
  const revenue = totals.INCOME - totals.REFUNDS;
  const operatingIncome = revenue - totals.COGS - totals.OPERATING;
  return {
    transactionCount,
    lineCount,
    grossRevenue: dollars(totals.INCOME),
    refunds: dollars(totals.REFUNDS),
    netRevenueExcludingReimbursements: dollars(revenue),
    cogs: dollars(totals.COGS),
    operatingExpenses: dollars(totals.OPERATING),
    operatingIncome: dollars(operatingIncome),
    reimbursements: dollars(totals.REIMBURSEMENT),
    personal: dollars(totals.PERSONAL),
    reimbursable: dollars(totals.REIMBURSABLE),
    unclassified: dollars(totals.UNCLASSIFIED),
    transfersExcluded: dollars(totals.TRANSFER),
  };
}

function classifyBankIncomeDescription(description: string, merchantName: string | null) {
  const text = `${description} ${merchantName ?? ''}`.toLowerCase();
  if (/transfer\s*in|transfer from|external transfer|ach credit/.test(text)) return 'TRANSFER_LIKE';
  if (/square|block inc/.test(text)) return 'SQUARE_LIKE';
  if (/zelle/.test(text)) return 'ZELLE';
  if (/deposit/.test(text)) return 'DEPOSIT';
  if (/interest/.test(text)) return 'INTEREST';
  if (/refund|reimbursement/.test(text)) return 'REFUND_OR_REIMBURSEMENT';
  return 'OTHER';
}

function externalIdShape(externalId: string | null) {
  if (!externalId) return 'NULL';
  for (const prefix of [
    'square_payment_',
    'square_fee_',
    'square_refund_',
    'square_payout_',
    'square_order_',
  ]) {
    if (externalId.startsWith(prefix)) return prefix.toUpperCase();
  }
  if (/^[A-Za-z0-9_-]{10,}$/.test(externalId)) return 'OPAQUE_PROVIDER_ID';
  return 'OTHER';
}

async function main() {
  const generatedAt = new Date();
  const transactions = await loadTransactions();
  const posted = transactions.filter((tx) => tx.status === 'POSTED');
  const activeOperating = posted.filter(
    (tx) => !tx.allocations.some((allocation) => allocation.role === 'BANK_SETTLEMENT')
  );

  const [
    users,
    entities,
    accounts,
    categories,
    receipts,
    lineItems,
    vendors,
    settlements,
    settlementEntries,
    allocations,
    auditEvents,
    balanceSnapshots,
    sourceIdentities,
  ] = await Promise.all([
    db.user.findMany({ select: { id: true } }),
    db.entity.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        isDefault: true,
        _count: { select: { financialAccounts: true, transactionsAsPayer: true, transactionsAsIncurred: true } },
      },
      orderBy: { name: 'asc' },
    }),
    db.financialAccount.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        institution: true,
        currentBalance: true,
        availableBalance: true,
        currency: true,
        isActive: true,
        isInternal: true,
        entityId: true,
        plaidAccountId: true,
        squareConnectionId: true,
        lastSyncedAt: true,
        openingBalance: true,
        openingBalanceDate: true,
      },
      orderBy: { name: 'asc' },
    }),
    db.category.findMany({ select: { id: true, name: true, defaultClassification: true } }),
    db.receipt.findMany({ select: { id: true, status: true, createdAt: true, receiptDate: true, transactionLinks: { select: { id: true } }, lineItems: { select: { id: true } } } }),
    db.lineItem.findMany({ select: { id: true, transactionId: true, receiptId: true, lineType: true, quantity: true, unitPrice: true, totalPrice: true } }),
    db.vendor.findMany({ select: { id: true } }),
    db.processorSettlement.findMany({
      select: {
        id: true,
        amount: true,
        status: true,
        reconciliationStatus: true,
        effectiveAt: true,
        arrivalDate: true,
        transactionId: true,
        entries: { where: { isCurrent: true }, select: { netAmount: true } },
        allocations: { where: { isCurrent: true }, select: { role: true, transactionId: true, amount: true } },
      },
      orderBy: { effectiveAt: 'asc' },
    }),
    db.processorSettlementEntry.findMany({
      where: { isCurrent: true },
      select: { id: true, settlementId: true, type: true, grossAmount: true, feeAmount: true, netAmount: true, paymentExternalId: true, refundExternalId: true },
    }),
    db.reconciliationAllocation.findMany({ where: { isCurrent: true }, select: { id: true, transactionId: true, settlementId: true, settlementEntryId: true, role: true, amount: true, method: true } }),
    db.financialAuditEvent.findMany({ select: { id: true, transactionId: true, action: true, source: true, changedFields: true, createdAt: true } }),
    db.accountBalanceSnapshot.findMany({ select: { id: true, accountId: true, effectiveAt: true, source: true } }),
    db.transactionSourceIdentity.findMany({ select: { id: true, transactionId: true, sourceSystem: true, sourceAccountId: true, externalId: true, isCurrent: true } }),
  ]);

  const entityById = new Map(entities.map((entity) => [entity.id, entity.name]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const txById = new Map(transactions.map((tx) => [tx.id, tx]));

  const splitMismatches = posted.filter((tx) => {
    if (!tx.splits.length) return false;
    return Math.abs(sumCents(tx.splits.map((split) => cent(split.amount))) - cent(tx.amount)) > 1;
  });

  const duplicateGroups = new Map<string, Tx[]>();
  for (const tx of transactions) {
    const normalizedText = `${tx.merchantName ?? ''}|${tx.description}`
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const key = [tx.accountId, tx.date.toISOString(), cent(tx.amount), tx.type, normalizedText].join('|');
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), tx]);
  }
  const exactDuplicateGroups = Array.from(duplicateGroups.values()).filter((group) => group.length > 1);

  const squareAccounts = new Set(accounts.filter((account) => account.squareConnectionId).map((account) => account.id));
  const squareTransactions = posted.filter((tx) => squareAccounts.has(tx.accountId));
  // Legacy Square rows may still carry the raw opaque provider id. Treat all
  // posted Square-ledger income as payment activity and separately report the
  // external-id shapes so canonicalization gaps remain visible.
  const squarePayments = squareTransactions.filter((tx) => tx.type === 'INCOME');
  const squareFees = squareTransactions.filter((tx) => tx.externalId?.startsWith('square_fee_'));
  const squareRefunds = squareTransactions.filter((tx) => tx.externalId?.startsWith('square_refund_'));
  const squarePayouts = squareTransactions.filter((tx) => tx.externalId?.startsWith('square_payout_'));

  const bankIncome = posted.filter(
    (tx) => !squareAccounts.has(tx.accountId) && tx.type === 'INCOME'
  );
  const bankIncomeUnallocated = bankIncome.filter(
    (tx) => !tx.allocations.some((allocation) => allocation.role === 'BANK_SETTLEMENT')
  );
  const bankIncomeByPattern = aggregateMoney(
    bankIncomeUnallocated.map((tx) => [classifyBankIncomeDescription(tx.description, tx.merchantName), cent(tx.amount)] as const)
  );

  const settlementMismatches = settlements.filter((settlement) => {
    const entryNet = sumCents(settlement.entries.map((entry) => Math.round(Number(entry.netAmount) * CENT)));
    return Math.abs(entryNet - Math.round(Number(settlement.amount) * CENT)) > 1;
  });
  const settlementStatus = aggregateMoney(
    settlements.map((settlement) => [settlement.reconciliationStatus, cent(settlement.amount)] as const)
  );
  const settlementEntryTypes = Object.values(
    settlementEntries.reduce<Record<string, { type: string; count: number; grossCents: number; feeCents: number; netCents: number }>>(
      (out, entry) => {
        const key = entry.type || 'UNKNOWN';
        const row = (out[key] ??= { type: key, count: 0, grossCents: 0, feeCents: 0, netCents: 0 });
        row.count += 1;
        row.grossCents += Math.round(Number(entry.grossAmount) * CENT);
        row.feeCents += Math.round(Number(entry.feeAmount) * CENT);
        row.netCents += Math.round(Number(entry.netAmount) * CENT);
        return out;
      },
      {}
    )
  )
    .map((row) => ({ type: row.type, count: row.count, gross: dollars(row.grossCents), fees: dollars(row.feeCents), net: dollars(row.netCents) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const loanLikeEntries = settlementEntryTypes.filter((entry) => /loan|capital|repay|financ/i.test(entry.type));
  const bankSettlementAllocations = allocations.filter((allocation) => allocation.role === 'BANK_SETTLEMENT');
  const originatingAllocations = allocations.filter((allocation) => allocation.role === 'ORIGINATING_ACTIVITY');
  const squarePaymentOriginCoverage = squarePayments.filter((tx) =>
    tx.allocations.some((allocation) => allocation.role === 'ORIGINATING_ACTIVITY')
  );

  const personalSinceApril = posted.filter((tx) => {
    if (tx.date < new Date('2026-04-01T00:00:00.000Z')) return false;
    if (tx.splits.length) {
      return tx.splits.some((split) =>
        (split.classification ?? split.category?.defaultClassification ?? effectiveClassification(tx)) === 'PERSONAL'
      );
    }
    return effectiveClassification(tx) === 'PERSONAL';
  });
  let personalSinceAprilCents = 0;
  let personalAttributedCents = 0;
  for (const tx of personalSinceApril) {
    const parentClassification = effectiveClassification(tx);
    const lines = tx.splits.length ? tx.splits : [tx];
    for (const line of lines) {
      const classification = line.classification ?? line.category?.defaultClassification ?? parentClassification;
      if (classification !== 'PERSONAL') continue;
      const amount = cent(line.amount);
      personalSinceAprilCents += amount;
      if (line.incurredById ?? tx.incurredById) personalAttributedCents += amount;
    }
  }

  const months = Array.from(new Set(activeOperating.map((tx) => month(tx.date)))).sort();
  const monthlyPnl = months.map((key) => ({ month: key, ...pnlFor(activeOperating.filter((tx) => month(tx.date) === key)) }));
  const statementWindow = activeOperating.filter(
    (tx) => tx.date >= new Date('2025-08-01T00:00:00.000Z') && tx.date < new Date('2026-08-01T00:00:00.000Z')
  );

  const ownerEntityFor = (tx: Tx) =>
    tx.account.entityId ? entityById.get(tx.account.entityId) ?? 'UNKNOWN_ENTITY' : 'UNASSIGNED_ENTITY';
  const pnlByOwnerEntity = Array.from(new Set(activeOperating.map(ownerEntityFor)))
    .sort()
    .map((ownerEntity) => ({
      ownerEntity,
      allDates: pnlFor(activeOperating.filter((tx) => ownerEntityFor(tx) === ownerEntity)),
      statementWindow: pnlFor(statementWindow.filter((tx) => ownerEntityFor(tx) === ownerEntity)),
    }));

  const sourceDuplicateGroups = new Map<string, number>();
  for (const identity of sourceIdentities) {
    const key = [identity.sourceSystem, identity.sourceAccountId ?? 'NULL', identity.externalId].join('|');
    sourceDuplicateGroups.set(key, (sourceDuplicateGroups.get(key) ?? 0) + 1);
  }

  const auditCoveredTransactions = new Set(auditEvents.flatMap((event) => event.transactionId ? [event.transactionId] : []));
  const materiallyUpdated = transactions.filter((tx) => tx.updatedAt.getTime() - tx.createdAt.getTime() > 1000);

  const accountSummary = accounts.map((account) => {
    const accountTransactions = transactions.filter((tx) => tx.accountId === account.id);
    const accountPosted = accountTransactions.filter((tx) => tx.status === 'POSTED');
    return {
      name: account.name,
      type: account.type,
      ownerEntity: account.entityId ? entityById.get(account.entityId) ?? 'UNKNOWN' : null,
      source: account.squareConnectionId ? 'SQUARE' : account.plaidAccountId ? 'PLAID' : 'MANUAL_OR_OTHER',
      active: account.isActive,
      internal: account.isInternal,
      currentBalance: Number(account.currentBalance),
      availableBalance: account.availableBalance == null ? null : Number(account.availableBalance),
      lastSyncedAt: iso(account.lastSyncedAt),
      openingBalance: account.openingBalance == null ? null : Number(account.openingBalance),
      openingBalanceDate: iso(account.openingBalanceDate),
      transactionCount: accountTransactions.length,
      postedCount: accountPosted.length,
      firstTransactionDate: iso(accountTransactions[0]?.date),
      lastTransactionDate: iso(accountTransactions.at(-1)?.date),
      postedByType: aggregateMoney(accountPosted.map((tx) => [tx.type, cent(tx.amount)] as const)),
      bankSettlementAllocationCount: accountPosted.filter((tx) => tx.allocations.some((allocation) => allocation.role === 'BANK_SETTLEMENT')).length,
    };
  });

  const expenseReceiptCoverage = (classification: EffectiveClassification) => {
    const rows = posted.filter((tx) => tx.type === 'EXPENSE' && effectiveClassification(tx) === classification);
    const covered = rows.filter((tx) => tx.receiptLinks.length > 0);
    return {
      classification,
      transactions: rows.length,
      amount: dollars(sumCents(rows.map((tx) => cent(tx.amount)))),
      withReceipt: covered.length,
      withReceiptAmount: dollars(sumCents(covered.map((tx) => cent(tx.amount)))),
      transactionCoveragePct: rows.length ? Number(((covered.length / rows.length) * 100).toFixed(2)) : 0,
    };
  };

  const report = {
    generatedAt: generatedAt.toISOString(),
    databaseMaxTransactionDate: iso(transactions.at(-1)?.date),
    dataModelCounts: {
      users: users.length,
      entities: entities.length,
      financialAccounts: accounts.length,
      activeFinancialAccounts: accounts.filter((account) => account.isActive).length,
      transactions: transactions.length,
      postedTransactions: posted.length,
      transactionSplits: sumCents(transactions.map((tx) => tx.splits.length)),
      categories: categories.length,
      vendors: vendors.length,
      receipts: receipts.length,
      lineItems: lineItems.length,
      processorSettlements: settlements.length,
      processorSettlementEntriesCurrent: settlementEntries.length,
      reconciliationAllocationsCurrent: allocations.length,
      financialAuditEvents: auditEvents.length,
      accountBalanceSnapshots: balanceSnapshots.length,
      transactionSourceIdentities: sourceIdentities.length,
    },
    entitySeparation: {
      entities: entities.map((entity) => ({
        name: entity.name,
        type: entity.type,
        isDefault: entity.isDefault,
        accounts: entity._count.financialAccounts,
        transactionsAsPayer: entity._count.transactionsAsPayer,
        transactionsAsIncurred: entity._count.transactionsAsIncurred,
      })),
      accountsWithoutEntity: accounts.filter((account) => !account.entityId).length,
      postedTransactionsWithoutPayer: posted.filter((tx) => !tx.payerId).length,
      postedTransactionsWithoutIncurredBy: posted.filter((tx) => !tx.incurredById).length,
      personalSinceApril2026: {
        transactionsTouchingPersonal: personalSinceApril.length,
        amount: dollars(personalSinceAprilCents),
        attributedAmount: dollars(personalAttributedCents),
        unattributedAmount: dollars(personalSinceAprilCents - personalAttributedCents),
      },
    },
    accounts: accountSummary,
    transactionQuality: {
      byStatusCount: Object.fromEntries(
        Array.from(new Set(transactions.map((tx) => tx.status))).sort().map((status) => [status, transactions.filter((tx) => tx.status === status).length])
      ),
      postedMoneyByType: aggregateMoney(posted.map((tx) => [tx.type, cent(tx.amount)] as const)),
      postedEffectiveClassification: aggregateMoney(posted.map((tx) => [effectiveClassification(tx), cent(tx.amount)] as const)),
      splitTransactionCount: posted.filter((tx) => tx.splits.length > 0).length,
      splitMismatchCount: splitMismatches.length,
      splitMismatchParentAmount: dollars(sumCents(splitMismatches.map((tx) => cent(tx.amount)))),
      exactDuplicateGroupCount: exactDuplicateGroups.length,
      exactDuplicateRowCount: sumCents(exactDuplicateGroups.map((group) => group.length)),
      exactDuplicatePostedAmount: dollars(sumCents(exactDuplicateGroups.flat().filter((tx) => tx.status === 'POSTED').map((tx) => cent(tx.amount)))),
      sourceIdentityDuplicateGroupCount: Array.from(sourceDuplicateGroups.values()).filter((count) => count > 1).length,
      materiallyUpdatedTransactions: materiallyUpdated.length,
      materiallyUpdatedWithAnyAuditEvent: materiallyUpdated.filter((tx) => auditCoveredTransactions.has(tx.id)).length,
    },
    livePnlAllDates: pnlFor(activeOperating),
    livePnlStatementWindow2025AugThrough2026Jul: pnlFor(statementWindow),
    pnlByAccountOwnerEntity: pnlByOwnerEntity,
    monthlyPnl,
    squareReconciliation: {
      squareAccounts: accounts.filter((account) => account.squareConnectionId).map((account) => account.name),
      paymentRows: squarePayments.length,
      paymentAmount: dollars(sumCents(squarePayments.map((tx) => cent(tx.amount)))),
      paymentRowsWithOriginatingAllocation: squarePaymentOriginCoverage.length,
      paymentAmountWithOriginatingAllocation: dollars(sumCents(squarePaymentOriginCoverage.map((tx) => cent(tx.amount)))),
      feeRows: squareFees.length,
      feeTransactionAmount: dollars(sumCents(squareFees.map((tx) => cent(tx.amount)))),
      refundRows: squareRefunds.length,
      refundAmount: dollars(sumCents(squareRefunds.map((tx) => cent(tx.amount)))),
      payoutRows: squarePayouts.length,
      payoutAmount: dollars(sumCents(squarePayouts.map((tx) => cent(tx.amount)))),
      squarePostedExternalIdShapes: Object.fromEntries(
        Array.from(new Set(squareTransactions.map((tx) => externalIdShape(tx.externalId))))
          .sort()
          .map((shape) => {
            const rows = squareTransactions.filter((tx) => externalIdShape(tx.externalId) === shape);
            return [shape, { rows: rows.length, amount: dollars(sumCents(rows.map((tx) => cent(tx.amount)))) }];
          })
      ),
      squareSourceIdentityCount: sourceIdentities.filter((identity) => identity.sourceSystem === 'SQUARE').length,
      squareSourceIdentityRelatedPostedTransactions: new Set(
        sourceIdentities
          .filter((identity) => identity.sourceSystem === 'SQUARE' && txById.get(identity.transactionId)?.status === 'POSTED')
          .map((identity) => identity.transactionId)
      ).size,
      settlementCount: settlements.length,
      settlementAmount: dollars(sumCents(settlements.map((settlement) => cent(settlement.amount)))),
      settlementAmountByReconciliationStatus: settlementStatus,
      settlementEntryMismatchCount: settlementMismatches.length,
      settlementEntryMismatchAmount: dollars(sumCents(settlementMismatches.map((settlement) => cent(settlement.amount)))),
      bankSettlementAllocationCount: bankSettlementAllocations.length,
      bankSettlementAllocatedAmount: dollars(sumCents(bankSettlementAllocations.map((allocation) => cent(allocation.amount)))),
      bankSettlementDistinctTransactions: new Set(bankSettlementAllocations.map((allocation) => allocation.transactionId)).size,
      originatingAllocationCount: originatingAllocations.length,
      currentEntryFeeAmountSigned: Number((settlementEntries.reduce((sum, entry) => sum + Number(entry.feeAmount), 0)).toFixed(2)),
      settlementEntryTypes,
      loanLikeEntries,
      bankIncomeRows: bankIncome.length,
      bankIncomeAmount: dollars(sumCents(bankIncome.map((tx) => cent(tx.amount)))),
      bankIncomeUnallocatedRows: bankIncomeUnallocated.length,
      bankIncomeUnallocatedAmount: dollars(sumCents(bankIncomeUnallocated.map((tx) => cent(tx.amount)))),
      bankIncomeUnallocatedByPattern: bankIncomeByPattern,
      bankIncomeUnallocatedByAccount: accounts
        .filter((account) => !squareAccounts.has(account.id))
        .map((account) => {
          const rows = bankIncomeUnallocated.filter((tx) => tx.accountId === account.id);
          return {
            account: account.name,
            ownerEntity: account.entityId ? entityById.get(account.entityId) ?? 'UNKNOWN' : null,
            rows: rows.length,
            amount: dollars(sumCents(rows.map((tx) => cent(tx.amount)))),
            byPattern: aggregateMoney(rows.map((tx) => [classifyBankIncomeDescription(tx.description, tx.merchantName), cent(tx.amount)] as const)),
          };
        })
        .filter((row) => row.rows > 0),
    },
    evidenceCoverage: {
      receiptStatusCounts: Object.fromEntries(
        Array.from(new Set(receipts.map((receipt) => receipt.status))).sort().map((status) => [status, receipts.filter((receipt) => receipt.status === status).length])
      ),
      receiptsLinkedToTransactions: receipts.filter((receipt) => receipt.transactionLinks.length > 0).length,
      receiptsWithLineItems: receipts.filter((receipt) => receipt.lineItems.length > 0).length,
      lineItemsLinkedToTransactions: lineItems.filter((item) => item.transactionId).length,
      lineItemsLinkedToReceipts: lineItems.filter((item) => item.receiptId).length,
      lineItemsWithQuantityAndUnitPrice: lineItems.filter((item) => item.quantity != null && item.unitPrice != null).length,
      expenseReceiptCoverage: [expenseReceiptCoverage('COGS'), expenseReceiptCoverage('OPERATING'), expenseReceiptCoverage('PERSONAL')],
    },
    controlCoverage: {
      auditEventsByAction: Object.fromEntries(
        Array.from(new Set(auditEvents.map((event) => event.action))).sort().map((action) => [action, auditEvents.filter((event) => event.action === action).length])
      ),
      auditEventsBySource: Object.fromEntries(
        Array.from(new Set(auditEvents.map((event) => event.source))).sort().map((source) => [source, auditEvents.filter((event) => event.source === source).length])
      ),
      firstAuditEventAt: iso(auditEvents[0]?.createdAt),
      lastAuditEventAt: iso(auditEvents.at(-1)?.createdAt),
      accountsWithOpeningBalanceAnchor: accounts.filter((account) => account.openingBalance != null && account.openingBalanceDate != null).length,
      accountsWithBalanceSnapshot: new Set(balanceSnapshots.map((snapshot) => snapshot.accountId)).size,
      settlementsWithBankAllocation: settlements.filter((settlement) => settlement.allocations.some((allocation) => allocation.role === 'BANK_SETTLEMENT')).length,
      settlementsWithoutBankAllocation: settlements.filter((settlement) => !settlement.allocations.some((allocation) => allocation.role === 'BANK_SETTLEMENT')).length,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
