/**
 * Read-only, aggregate-only Venmo revenue and duplicate-risk audit.
 *
 * This script reads transaction text and Venmo statement metadata only to
 * perform matching. It emits no descriptions, counterparties, notes, account
 * numbers, transaction ids, statement ids, or raw metadata.
 *
 * Run:
 *   pnpm exec tsx scripts/audit-venmo-revenue.ts
 */

import './load-env';
import { PrismaClient } from '@prisma/client';
import { getVenmoCandidateAmounts, venmoExpectsBankCounterpart } from '../src/lib/venmo-matching';
import { parseVenmoStatementDetails } from '../src/lib/venmo-metadata';

const db = new PrismaClient();
const DAY_MS = 86_400_000;
const roundMoney = (value: number) => Number(value.toFixed(2));
const cents = (value: unknown) => Math.round(Math.abs(Number(value ?? 0)) * 100);
const dollars = (value: number) => roundMoney(value / 100);

type LoadedTransaction = Awaited<ReturnType<typeof loadTransactions>>[number];

function effectiveClassification(transaction: LoadedTransaction): string {
  return (
    transaction.classification ||
    transaction.category?.defaultClassification ||
    (transaction.type === 'INCOME'
      ? 'INCOME'
      : transaction.type === 'TRANSFER'
        ? 'TRANSFER'
        : 'UNCLASSIFIED')
  );
}

function isTransfer(transaction: LoadedTransaction): boolean {
  return transaction.type === 'TRANSFER' || effectiveClassification(transaction) === 'TRANSFER';
}

function isPnlIncome(transaction: LoadedTransaction): boolean {
  if (transaction.type !== 'INCOME' || isTransfer(transaction)) return false;
  if (transaction.splits.length === 0) return effectiveClassification(transaction) === 'INCOME';
  return transaction.splits.some(
    (split) =>
      (split.classification || split.category?.defaultClassification || 'UNCLASSIFIED') === 'INCOME'
  );
}

function isPnlExpense(transaction: LoadedTransaction): boolean {
  if (transaction.type !== 'EXPENSE' || isTransfer(transaction)) return false;
  const included = new Set(['COGS', 'OPERATING']);
  if (transaction.splits.length === 0) return included.has(effectiveClassification(transaction));
  return transaction.splits.some((split) =>
    included.has(split.classification || split.category?.defaultClassification || 'UNCLASSIFIED')
  );
}

function dayDifference(a: Date, b: Date): number {
  return Math.abs(
    Math.round(
      (Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
        Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) /
        DAY_MS
    )
  );
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function statementFingerprint(transaction: LoadedTransaction): string | null {
  const details = parseVenmoStatementDetails(transaction.metadata);
  if (!details.isCanonical || !details.statementDateTime || details.amountTotalSigned == null) {
    return null;
  }
  return [
    details.statementDateTime,
    normalized(details.type),
    roundMoney(details.amountTotalSigned),
    roundMoney(details.amountFeeSigned ?? 0),
    normalized(details.from),
    normalized(details.to),
    normalized(details.note),
    normalized(details.fundingSource),
    normalized(details.destination),
  ].join('|');
}

function transactionText(transaction: LoadedTransaction): string {
  return `${transaction.description} ${transaction.merchantName ?? ''}`.toLowerCase();
}

function hasVenmoOrTransferEvidence(transaction: LoadedTransaction): boolean {
  return /venmo|transfer|cashout|cash out|withdrawal|deposit|ach|xfer|external|instant/.test(
    transactionText(transaction)
  );
}

async function loadTransactions() {
  return db.transaction.findMany({
    where: { status: 'POSTED', removedAt: null },
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      date: true,
      description: true,
      merchantName: true,
      classification: true,
      externalId: true,
      metadata: true,
      category: { select: { defaultClassification: true } },
      splits: {
        select: {
          amount: true,
          classification: true,
          category: { select: { defaultClassification: true } },
        },
      },
      account: {
        select: {
          name: true,
          institution: true,
          providerData: true,
          entityId: true,
        },
      },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
}

function isVenmoWallet(transaction: LoadedTransaction): boolean {
  const provider =
    transaction.account.providerData &&
    typeof transaction.account.providerData === 'object' &&
    !Array.isArray(transaction.account.providerData)
      ? (transaction.account.providerData as Record<string, unknown>)
      : null;
  return (
    provider?.venmoWallet === true ||
    /venmo/i.test(`${transaction.account.name} ${transaction.account.institution ?? ''}`)
  );
}

function summarizeByClassification(transactions: LoadedTransaction[]) {
  const totals: Record<string, { transactions: number; amount: number }> = {};
  for (const transaction of transactions) {
    const key = effectiveClassification(transaction);
    const current = totals[key] ?? { transactions: 0, amount: 0 };
    current.transactions += 1;
    current.amount += cents(transaction.amount);
    totals[key] = current;
  }
  return Object.fromEntries(
    Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, { ...value, amount: dollars(value.amount) }])
  );
}

async function main() {
  const transactions = await loadTransactions();
  const walletTransactions = transactions.filter(isVenmoWallet);
  const nonWalletTransactions = transactions.filter((transaction) => !isVenmoWallet(transaction));
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));

  const statementIdGroups = new Map<string, LoadedTransaction[]>();
  for (const transaction of transactions) {
    const statementId = parseVenmoStatementDetails(transaction.metadata).statementId;
    if (!statementId) continue;
    const group = statementIdGroups.get(statementId) ?? [];
    group.push(transaction);
    statementIdGroups.set(statementId, group);
  }

  let statementCollisionGroups = 0;
  let statementCollisionRows = 0;
  let statementCollisionPotentialOvercount = 0;
  for (const group of Array.from(statementIdGroups.values())) {
    if (new Set(group.map((transaction) => transaction.accountId)).size < 2) continue;
    statementCollisionGroups += 1;
    statementCollisionRows += group.length;
    const pnlRows = group.filter((transaction) => isPnlIncome(transaction) || isPnlExpense(transaction));
    if (pnlRows.length > 1) {
      const amounts = pnlRows.map((transaction) => cents(transaction.amount));
      statementCollisionPotentialOvercount += amounts.reduce((sum, amount) => sum + amount, 0) - Math.max(...amounts);
    }
  }

  const fingerprintGroups = new Map<string, LoadedTransaction[]>();
  for (const transaction of walletTransactions) {
    if (transaction.externalId?.startsWith('venmo-statement-fee:')) continue;
    const fingerprint = statementFingerprint(transaction);
    if (!fingerprint) continue;
    const group = fingerprintGroups.get(fingerprint) ?? [];
    group.push(transaction);
    fingerprintGroups.set(fingerprint, group);
  }
  const duplicateFinancialFacts = Array.from(fingerprintGroups.values()).filter(
    (group) => group.length > 1
  );

  const transferLinks = await db.transactionLink.findMany({
    where: {
      linkType: { equals: 'TRANSFER', mode: 'insensitive' },
      OR: [
        { fromId: { in: walletTransactions.map((transaction) => transaction.id) } },
        { toId: { in: walletTransactions.map((transaction) => transaction.id) } },
      ],
    },
    select: { fromId: true, toId: true, amount: true },
  });
  const linkedBankIds = new Set<string>();
  for (const link of transferLinks) {
    const otherId = walletTransactions.some((transaction) => transaction.id === link.fromId)
      ? link.toId
      : link.fromId;
    linkedBankIds.add(otherId);
  }

  const canonicalRows = walletTransactions.filter(
    (transaction) => parseVenmoStatementDetails(transaction.metadata).isCanonical
  );
  const canonicalMainRows = canonicalRows.filter(
    (transaction) => !transaction.externalId?.startsWith('venmo-statement-fee:')
  );
  let canonicalWithBankLink = 0;
  let linkedBankLegsStillInPnl = 0;
  let linkedBankLegsStillInPnlAmount = 0;
  const metadataLinkedBankIds = new Set<string>();
  for (const transaction of canonicalMainRows) {
    const details = parseVenmoStatementDetails(transaction.metadata);
    if (!details.matchedBankTransactionId) continue;
    canonicalWithBankLink += 1;
    metadataLinkedBankIds.add(details.matchedBankTransactionId);
    const bank = byId.get(details.matchedBankTransactionId);
    if (bank && (isPnlIncome(bank) || isPnlExpense(bank))) {
      linkedBankLegsStillInPnl += 1;
      linkedBankLegsStillInPnlAmount += cents(bank.amount);
    }
  }

  const allLinkedBankIds = new Set([
    ...Array.from(linkedBankIds),
    ...Array.from(metadataLinkedBankIds),
  ]);
  const expectedCounterparts = canonicalMainRows.filter((transaction) => {
    const details = parseVenmoStatementDetails(transaction.metadata);
    return venmoExpectsBankCounterpart({
      type: details.type ?? '',
      fundingSource: details.fundingSource ?? '',
      amountTotalSigned: details.amountTotalSigned ?? Number(transaction.amount),
      amountFeeSigned: details.amountFeeSigned ?? 0,
    });
  });

  let expectedAlreadyLinked = 0;
  let expectedClearUnlinkedCandidate = 0;
  let expectedAmbiguousUnlinkedCandidate = 0;
  let expectedNoCandidate = 0;
  let clearUnlinkedCandidateStillInPnl = 0;
  let clearUnlinkedCandidateStillInPnlAmount = 0;
  let ambiguousCandidateSetsWithAnyPnl = 0;
  const ambiguousPnlCandidateIds = new Set<string>();

  for (const canonical of expectedCounterparts) {
    const details = parseVenmoStatementDetails(canonical.metadata);
    if (details.hasBankLink || transferLinks.some((link) => link.fromId === canonical.id || link.toId === canonical.id)) {
      expectedAlreadyLinked += 1;
      continue;
    }
    const signedTotal = details.amountTotalSigned ?? Number(canonical.amount);
    const expectedTypes = canonical.type === 'EXPENSE'
      ? new Set(['EXPENSE', 'TRANSFER'])
      : new Set(signedTotal < 0 ? ['INCOME', 'TRANSFER'] : ['EXPENSE', 'TRANSFER']);
    const amountOptions = getVenmoCandidateAmounts({
      type: details.type ?? '',
      fundingSource: details.fundingSource ?? '',
      amountTotalSigned: signedTotal,
      amountFeeSigned: details.amountFeeSigned ?? 0,
    });
    const candidates = nonWalletTransactions.filter((candidate) => {
      if (allLinkedBankIds.has(candidate.id)) return false;
      if (!expectedTypes.has(candidate.type)) return false;
      if (dayDifference(candidate.date, canonical.date) > 3) return false;
      if (!hasVenmoOrTransferEvidence(candidate)) return false;
      const candidateAmount = Math.abs(Number(candidate.amount));
      return amountOptions.some((option) => Math.abs(candidateAmount - option.amount) <= 0.02);
    });
    if (candidates.length === 0) {
      expectedNoCandidate += 1;
    } else if (candidates.length > 1) {
      expectedAmbiguousUnlinkedCandidate += 1;
      const pnlCandidates = candidates.filter(
        (candidate) => isPnlIncome(candidate) || isPnlExpense(candidate)
      );
      if (pnlCandidates.length > 0) ambiguousCandidateSetsWithAnyPnl += 1;
      for (const candidate of pnlCandidates) ambiguousPnlCandidateIds.add(candidate.id);
    } else {
      expectedClearUnlinkedCandidate += 1;
      const candidate = candidates[0];
      if (isPnlIncome(candidate) || isPnlExpense(candidate)) {
        clearUnlinkedCandidateStillInPnl += 1;
        clearUnlinkedCandidateStillInPnlAmount += cents(candidate.amount);
      }
    }
  }

  const bankVenmoRows = nonWalletTransactions.filter((transaction) =>
    /venmo/.test(transactionText(transaction))
  );
  const unlinkedBankVenmoIncome = bankVenmoRows.filter(
    (transaction) => isPnlIncome(transaction) && !allLinkedBankIds.has(transaction.id)
  );

  const walletRevenueRows = walletTransactions.filter(isPnlIncome);
  const sameAmountRevenuePairs = new Set<string>();
  let sameAmountRevenueCandidateAmount = 0;
  for (const walletRevenue of walletRevenueRows) {
    const candidates = unlinkedBankVenmoIncome.filter(
      (bankRevenue) =>
        Math.abs(Number(bankRevenue.amount) - Number(walletRevenue.amount)) <= 0.01 &&
        dayDifference(bankRevenue.date, walletRevenue.date) <= 7
    );
    for (const candidate of candidates) {
      const pairKey = `${walletRevenue.id}|${candidate.id}`;
      if (sameAmountRevenuePairs.has(pairKey)) continue;
      sameAmountRevenuePairs.add(pairKey);
      sameAmountRevenueCandidateAmount += cents(candidate.amount);
    }
  }

  const sourceIdentities = await db.transactionSourceIdentity.findMany({
    select: {
      sourceSystem: true,
      sourceAccountId: true,
      externalId: true,
      transactionId: true,
    },
  });
  const sourceIdentityMap = new Map<string, Set<string>>();
  for (const identity of sourceIdentities) {
    const key = `${identity.sourceSystem}|${identity.sourceAccountId ?? ''}|${identity.externalId}`;
    const transactionIds = sourceIdentityMap.get(key) ?? new Set<string>();
    transactionIds.add(identity.transactionId);
    sourceIdentityMap.set(key, transactionIds);
  }
  const duplicateSourceIdentityGroups = Array.from(sourceIdentityMap.values()).filter(
    (transactionIds) => transactionIds.size > 1
  ).length;

  const walletIncomeAmount = walletRevenueRows.reduce(
    (sum, transaction) => sum + cents(transaction.amount),
    0
  );
  const result = {
    generatedAt: new Date().toISOString(),
    databaseMaxTransactionDate:
      transactions.length > 0 ? transactions[transactions.length - 1].date.toISOString() : null,
    coverage: {
      postedCurrentTransactions: transactions.length,
      venmoWalletAccounts: new Set(walletTransactions.map((transaction) => transaction.accountId)).size,
      venmoWalletTransactions: walletTransactions.length,
      canonicalStatementMainRows: canonicalMainRows.length,
      canonicalStatementFeeRows: canonicalRows.length - canonicalMainRows.length,
      statementIdsAcrossAllAccounts: statementIdGroups.size,
    },
    walletAccounting: {
      byClassification: summarizeByClassification(walletTransactions),
      pnlRevenueTransactions: walletRevenueRows.length,
      pnlRevenueAmount: dollars(walletIncomeAmount),
      walletRowsWithoutEntityOwner: walletTransactions.filter(
        (transaction) => !transaction.account.entityId
      ).length,
    },
    deterministicIdentityChecks: {
      duplicateSourceIdentityGroups,
      duplicateCanonicalFinancialFactGroups: duplicateFinancialFacts.length,
      duplicateCanonicalFinancialFactRows: duplicateFinancialFacts.reduce(
        (sum, group) => sum + group.length,
        0
      ),
      repeatedStatementIdGroupsAcrossAccounts: statementCollisionGroups,
      repeatedStatementIdRowsAcrossAccounts: statementCollisionRows,
      repeatedStatementIdPotentialPnlOvercount: dollars(statementCollisionPotentialOvercount),
    },
    explicitBankCounterpartChecks: {
      canonicalRowsExpectingBankCounterpart: expectedCounterparts.length,
      alreadyLinked: expectedAlreadyLinked,
      clearUnlinkedCandidate: expectedClearUnlinkedCandidate,
      ambiguousUnlinkedCandidate: expectedAmbiguousUnlinkedCandidate,
      noCandidateWithinThreeDays: expectedNoCandidate,
      linkedBankLegsStillContributingToPnl: linkedBankLegsStillInPnl,
      linkedBankLegsStillContributingToPnlAmount: dollars(linkedBankLegsStillInPnlAmount),
      clearUnlinkedCandidatesStillContributingToPnl: clearUnlinkedCandidateStillInPnl,
      clearUnlinkedCandidatesStillContributingToPnlAmount: dollars(
        clearUnlinkedCandidateStillInPnlAmount
      ),
      ambiguousCandidateSetsWithAnyPnl,
      ambiguousPnlCandidateLegs: ambiguousPnlCandidateIds.size,
      ambiguousPnlCandidateLegsAmount: dollars(
        Array.from(ambiguousPnlCandidateIds).reduce(
          (sum, id) => sum + cents(byId.get(id)?.amount ?? 0),
          0
        )
      ),
    },
    broaderRevenueCandidateChecks: {
      bankRowsWithVenmoText: bankVenmoRows.length,
      unlinkedBankRowsWithVenmoTextStillCountedAsRevenue: unlinkedBankVenmoIncome.length,
      unlinkedBankRowsWithVenmoTextStillCountedAsRevenueAmount: dollars(
        unlinkedBankVenmoIncome.reduce((sum, transaction) => sum + cents(transaction.amount), 0)
      ),
      sameAmountWithinSevenDaysWalletToBankRevenueCandidatePairs: sameAmountRevenuePairs.size,
      candidateBankRevenueAmountBeforeManualReview: dollars(sameAmountRevenueCandidateAmount),
    },
    interpretation: {
      confirmedDoubleCountDefinition:
        'A shared statement identity or explicit wallet-bank link where more than one active leg still contributes to P&L.',
      candidateDefinition:
        'An unlinked exact-amount/date/text match. Candidates require source-statement review and are not deleted automatically.',
    },
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
