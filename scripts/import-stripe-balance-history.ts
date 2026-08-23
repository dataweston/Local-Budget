/** Import Stripe balance-history CSV rows into immutable SourceEvent only. */

import './load-env';
import { readFile } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import { parseStripeBalanceCsv } from '../src/lib/accounting/stripe-import';
import { ingestSourceEvent } from '../src/lib/accounting/source-events';

const db = new PrismaClient();
const apply = process.argv.includes('--apply');
const value = (name: string) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const file = value('--file');
const account = value('--account');
const userEmail = value('--user-email');

async function main() {
  if (!file || !account) {
    throw new Error('usage: --file=<Stripe balance CSV> --account=<Stripe account id> [--user-email=<email>] [--apply]');
  }
  const rows = parseStripeBalanceCsv(await readFile(file, 'utf8'));
  const invalidArithmetic = rows.filter((row) => !row.arithmeticOk);
  const summary = {
    rows: rows.length,
    firstOccurredAt: rows.length ? rows.reduce((a, b) => (a.occurredAt < b.occurredAt ? a : b)).occurredAt.toISOString() : null,
    lastOccurredAt: rows.length ? rows.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b)).occurredAt.toISOString() : null,
    currencies: Array.from(new Set(rows.map((row) => row.currency))),
    invalidArithmetic: invalidArithmetic.length,
  };
  if (!apply) {
    console.log(JSON.stringify({ apply: false, account, ...summary }, null, 2));
    return;
  }
  if (!userEmail) throw new Error('--user-email is required with --apply');
  if (invalidArithmetic.length) throw new Error('refusing apply: Stripe gross/fee/net arithmetic exceptions exist');
  const user = await db.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) throw new Error('user not found');
  let created = 0;
  let existing = 0;
  for (const row of rows) {
    const result = await ingestSourceEvent(db, {
      userId: user.id,
      sourceSystem: 'STRIPE',
      sourceNamespace: account,
      externalId: row.externalId,
      eventType: `stripe.balance.${row.reportingCategory || 'unknown'}`,
      occurredAt: row.occurredAt,
      settledAt: row.availableAt ?? undefined,
      payloadHash: row.payloadHash,
      parserVersion: 'stripe-balance-csv.v1',
      payload: {
        currency: row.currency,
        grossCents: row.grossCents,
        feeCents: row.feeCents,
        netCents: row.netCents,
        reportingCategory: row.reportingCategory,
        sourceId: row.sourceId,
        description: row.description,
        arithmeticOk: row.arithmeticOk,
      },
    });
    if (result.created) created++; else existing++;
  }
  console.log(JSON.stringify({ apply: true, account, ...summary, created, existing }, null, 2));
}

main()
  .catch((error) => {
    console.error('Stripe balance import failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
