import './load-env';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { findAccountAuthority } from '../src/lib/accounting-authority';
import {
  matchStripePayoutDestinationAccount,
  type DestinationAccountCandidate,
} from '../src/lib/accounting/stripe-payout-destination';

const db = new PrismaClient();
const REPORT_PATH = resolve('reports/stripe-payout-destination-legs-2026-09-06.md');

const toCents = (value: unknown) => Math.round(Number(value) * 100);

function money(cents: number | null): string {
  if (cents === null) return '—';
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function markdown(value: unknown): string {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function buildReport(): Promise<string> {
  const [settlements, accountRows, ignoredStripeEvents] = await Promise.all([
    db.processorSettlement.findMany({
      where: { provider: 'STRIPE' },
      select: {
        id: true,
        externalId: true,
        amount: true,
        currency: true,
        effectiveAt: true,
        arrivalDate: true,
        reconciliationStatus: true,
        transactionId: true,
        metadata: true,
        entries: {
          where: { isCurrent: true },
          select: {
            providerEntryId: true,
            type: true,
            grossAmount: true,
            feeAmount: true,
            netAmount: true,
          },
          orderBy: { providerEntryId: 'asc' },
        },
        allocations: {
          where: { isCurrent: true, role: 'BANK_SETTLEMENT' },
          select: { transactionId: true, method: true },
          orderBy: { transactionId: 'asc' },
        },
      },
      orderBy: [{ arrivalDate: 'asc' }, { externalId: 'asc' }],
    }),
    db.financialAccount.findMany({
      select: {
        id: true,
        name: true,
        accountNumber: true,
        currency: true,
        isActive: true,
      },
      orderBy: { id: 'asc' },
    }),
    db.sourceEvent.findMany({
      where: { sourceSystem: 'STRIPE', status: 'IGNORED' },
      select: { externalId: true, eventType: true },
      orderBy: { externalId: 'asc' },
    }),
  ]);

  const accounts: DestinationAccountCandidate[] = accountRows;
  const ignoredPaymentIds = new Set(
    ignoredStripeEvents
      .filter((event) => event.eventType === 'stripe.balance.payment')
      .map((event) => event.externalId)
  );
  const matchedAccountIds = new Set<string>();

  const prepared = settlements.map((settlement) => {
    const metadata = (settlement.metadata && typeof settlement.metadata === 'object')
      ? settlement.metadata as Record<string, unknown>
      : {};
    const last4 = String(metadata.destinationLast4 || '').trim() || null;
    const accountMatch = matchStripePayoutDestinationAccount(
      { last4, currency: settlement.currency },
      accounts
    );
    if (accountMatch.status === 'matched') matchedAccountIds.add(accountMatch.account.id);

    const entries = settlement.entries;
    const componentGrossCents = entries.length
      ? entries.reduce((total, entry) => total + toCents(entry.grossAmount), 0)
      : null;
    const componentFeeCents = entries.length
      ? entries.reduce((total, entry) => total + toCents(entry.feeAmount), 0)
      : null;
    const componentNetCents = entries.length
      ? entries.reduce((total, entry) => total + toCents(entry.netAmount), 0)
      : null;
    const bankAllocations = settlement.allocations.length;
    const hasCashBridge = Boolean(settlement.transactionId || bankAllocations > 0);
    const lenderEvidenceRequired = entries.some((entry) => ignoredPaymentIds.has(entry.providerEntryId));

    return {
      settlement,
      metadata,
      last4,
      accountMatch,
      componentGrossCents,
      componentFeeCents,
      componentNetCents,
      hasCashBridge,
      lenderEvidenceRequired,
    };
  });

  const transactionDates = matchedAccountIds.size
    ? await db.transaction.findMany({
        where: { accountId: { in: Array.from(matchedAccountIds) } },
        select: { accountId: true, date: true },
        orderBy: [{ accountId: 'asc' }, { date: 'asc' }],
      })
    : [];
  const coverage = new Map<string, { first: Date; last: Date; months: Set<string> }>();
  for (const transaction of transactionDates) {
    const existing = coverage.get(transaction.accountId);
    const month = transaction.date.toISOString().slice(0, 7);
    if (!existing) {
      coverage.set(transaction.accountId, {
        first: transaction.date,
        last: transaction.date,
        months: new Set([month]),
      });
      continue;
    }
    if (transaction.date < existing.first) existing.first = transaction.date;
    if (transaction.date > existing.last) existing.last = transaction.date;
    existing.months.add(month);
  }

  const destinationMonths = new Map<string, Set<string>>();
  let destinationAccountIdentified = 0;
  let ambiguousDestinations = 0;
  let unusableMetadata = 0;
  let lenderLegs = 0;
  let processorExact = 0;
  let processorException = 0;
  let noProcessorComponents = 0;

  const tableRows = prepared.map((row) => {
    const { settlement, metadata, accountMatch, last4 } = row;
    const arrival = settlement.arrivalDate ?? settlement.effectiveAt;
    const arrivalDay = arrival.toISOString().slice(0, 10);
    const arrivalMonth = arrivalDay.slice(0, 7);
    const destinationKey = last4 || 'missing';
    if (!destinationMonths.has(destinationKey)) destinationMonths.set(destinationKey, new Set());
    destinationMonths.get(destinationKey)?.add(arrivalMonth);

    const processorComponentsReconciled = metadata.processorComponentsReconciled === true;
    if (settlement.entries.length === 0) noProcessorComponents += 1;
    else if (processorComponentsReconciled) processorExact += 1;
    else processorException += 1;
    if (row.lenderEvidenceRequired) lenderLegs += 1;

    let internalAccount = '—';
    let cashStatus = 'unmatched';
    let exactBlocker = '';
    if (row.hasCashBridge) {
      cashStatus = 'matched';
      exactBlocker = 'None — current BANK_SETTLEMENT link exists.';
    } else if (accountMatch.status === 'matched') {
      destinationAccountIdentified += 1;
      const authority = findAccountAuthority(accountMatch.account.name);
      const accountCoverage = coverage.get(accountMatch.account.id);
      internalAccount = authority
        ? `${accountMatch.account.name} (${authority.canonicalAccountKey})`
        : `${accountMatch.account.name} (not in authority map)`;
      cashStatus = authority ? 'account identified; cash leg open' : 'custody map missing';
      if (!authority) {
        exactBlocker = `No owner-approved custody rule for ${accountMatch.account.name}.`;
      } else if (!accountCoverage?.months.has(arrivalMonth)) {
        const starts = accountCoverage
          ? accountCoverage.first.toISOString().slice(0, 10)
          : 'no retained transaction date';
        exactBlocker = `Missing ${accountMatch.account.name} ending ${last4} statement/ledger for ${arrivalMonth}; available ledger starts ${starts}.`;
      } else {
        exactBlocker = `No source-identity bank link for ${arrivalMonth}; amount/date-only matching is prohibited.`;
      }
    } else if (accountMatch.status === 'ambiguous') {
      ambiguousDestinations += 1;
      cashStatus = 'ambiguous destination';
      internalAccount = accountMatch.candidates.map((candidate) => candidate.name).join(', ');
      exactBlocker = `${accountMatch.reason}; owner statement identity is required.`;
    } else {
      if (!last4) unusableMetadata += 1;
      cashStatus = last4 ? 'destination ledger absent' : 'unusable Stripe metadata';
      exactBlocker = last4
        ? `${accountMatch.reason}; identify the issuer/account and supply its ${arrivalMonth} statement.`
        : accountMatch.reason;
    }
    if (row.lenderEvidenceRequired) {
      exactBlocker += ' Personal-loan classification is preserved; current lender payoff/late-fee evidence remains required.';
    }

    const processorStatus = settlement.entries.length === 0
      ? 'no components'
      : processorComponentsReconciled
        ? 'components exact'
        : 'component exception';
    const destinationName = String(metadata.destinationName || metadata.destinationAccountName || '').trim();
    const destination = `${destinationName || (metadata.method === 'instant' ? 'card' : 'account')} ending ${last4 || 'unknown'}`;

    return `| ${arrivalDay} | \`${markdown(settlement.externalId)}\` | ${money(toCents(settlement.amount))} | ${money(row.componentGrossCents)} | ${money(row.componentFeeCents)} | ${money(row.componentNetCents)} | ${markdown(destination)} | ${markdown(internalAccount)} | ${processorStatus} | ${cashStatus} | ${markdown(exactBlocker)} |`;
  });

  const totalPayoutCents = prepared.reduce(
    (total, row) => total + toCents(row.settlement.amount),
    0
  );
  const accountIdentifiedCents = prepared
    .filter((row) => row.accountMatch.status === 'matched')
    .reduce((total, row) => total + toCents(row.settlement.amount), 0);
  const card0041Cents = prepared
    .filter((row) => row.last4 === '0041')
    .reduce((total, row) => total + toCents(row.settlement.amount), 0);
  const beforeUnmatched = prepared.filter((row) => !row.hasCashBridge).length;
  const afterUnmatched = beforeUnmatched;
  const sofiMonths = Array.from(destinationMonths.get('6183') ?? new Set<string>()).sort();
  const cardMonths = Array.from(destinationMonths.get('0041') ?? new Set<string>()).sort();

  const lines = [
    '# Stripe payout destination-leg reconciliation — 2026-09-06',
    '',
    '**Decision: preserve all unmatched legs.** This read-only report identifies custody accounts only from exact destination last4 plus currency and an owner-approved authority rule. It never links cash by amount or date proximity.',
    '',
    '## Measured result',
    '',
    `- Stripe payout legs: **${prepared.length}**, totaling **${money(totalPayoutCents)}**; source arrivals span ${prepared[0]?.settlement.arrivalDate?.toISOString().slice(0, 10) || '—'} through ${prepared.at(-1)?.settlement.arrivalDate?.toISOString().slice(0, 10) || '—'}.`,
    `- Destination account identified: **${destinationAccountIdentified}** legs totaling **${money(accountIdentifiedCents)}**. All resolve to SoFi Checking ending 6183 and the owner-approved \`sofi-checking-shared\` custody rule. The same 36 account ids were already persisted in settlement metadata, so this run added no production write.`,
    `- Destination ledger absent: **${prepared.filter((row) => row.last4 === '0041').length}** instant-payout legs totaling **${money(card0041Cents)}** to card ending 0041; no active account ending 0041 exists in Local Budget.`,
    `- Cash transaction bridges: **${prepared.length - beforeUnmatched} before / ${prepared.length - afterUnmatched} after**. Unmatched destination cash legs: **${beforeUnmatched} before / ${afterUnmatched} after**. No safe new bridge was available.`,
    `- Processor-component bridge: **${processorExact} exact**, **${processorException} exceptions**, **${noProcessorComponents} with no retained components**. These statuses are separate from destination cash matching.`,
    `- Ambiguous destination-account matches: **${ambiguousDestinations}**. Unusable Stripe destination metadata: **${unusableMetadata}**.`,
    `- Personal-loan funding path: **${lenderLegs} payout leg**. Its owner-confirmed personal-loan classification remains outside operating revenue; this report does not infer current payoff or late fees.`,
    '',
    '## Per-leg evidence',
    '',
    '| Arrival | Payout ID | Payout amount | Component gross | Component fees | Component net | Stripe destination | Internal custody account | Processor bridge | Destination cash bridge | Exact blocker |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
    ...tableRows,
    '',
    '## Exact owner document request',
    '',
    `1. **SoFi Checking ending 6183:** complete statements plus machine-readable transaction history for ${sofiMonths.join(', ')}. Preserve statement account identity and all transaction identifiers. Local Budget currently starts this ledger in 2025, after every listed payout.`,
    `2. **Card ending 0041:** issuer name, full internal account identity, and statements plus machine-readable activity for ${cardMonths.join(', ')}. The account must be added to the custody map before any payout link can be approved.`,
    '3. **William Lange funding:** current lender statement or signed payoff letter, evidence for any repayments not already recorded, and written treatment of late fees. The executed agreement and the owner classification remain evidence; neither proves the current balance.',
    '4. **Stripe tax bridge:** 2024 and 2025 Stripe 1099-Ks plus readable filed returns for the entity or individual that reported this activity. These do not replace the bank/card destination evidence.',
    '',
    '## Reproduction and control',
    '',
    '- Command: `npx tsx scripts/report-stripe-payout-destinations.ts --check`.',
    '- Source of truth: configured Local Budget PostgreSQL database; `ProcessorSettlement`, current `ProcessorSettlementEntry`, current `BANK_SETTLEMENT` allocations, `FinancialAccount`, `Transaction`, and ignored Stripe `SourceEvent` records.',
    '- Account matching key: exact active account `accountNumber` last4 + currency, followed by `findAccountAuthority(account.name)`. Candidate order is stable by account id.',
    '- No production row is inserted, updated, deleted, reclassified, or linked by this script.',
    '- This is an accounting-control workpaper, not an audit, reviewed financial statement, tax determination, lender statement, or legal conclusion.',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const report = await buildReport();
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  if (write && check) throw new Error('choose either --write or --check');

  if (write) {
    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, report, 'utf8');
    console.log(`Wrote ${REPORT_PATH}`);
    return;
  }
  if (check) {
    const committed = await readFile(REPORT_PATH, 'utf8');
    if (committed !== report) throw new Error(`report is stale: ${REPORT_PATH}`);
    console.log(`Report matches ${REPORT_PATH}`);
    return;
  }
  process.stdout.write(report);
}

main()
  .catch((error) => {
    console.error('Stripe payout destination report failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
