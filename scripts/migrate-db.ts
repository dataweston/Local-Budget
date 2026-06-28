/**
 * One-off data migration: copy all rows from a SOURCE Prisma Postgres DB
 * into a TARGET Prisma Postgres DB that already has the schema applied.
 *
 * Usage (PowerShell):
 *   $env:SOURCE_DATABASE_URL="postgres://...source..."
 *   $env:TARGET_DATABASE_URL="postgres://...target..."
 *   npx tsx scripts/migrate-db.ts            # dry run: counts only
 *   npx tsx scripts/migrate-db.ts --run      # actually copy
 *
 * Safe to re-run: uses createMany({ skipDuplicates: true }).
 * Tables are copied in foreign-key dependency order.
 */
import { PrismaClient } from "@prisma/client";

const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_URL = process.env.TARGET_DATABASE_URL;
const RUN = process.argv.includes("--run");
const BATCH = 500;

if (!SOURCE_URL || !TARGET_URL) {
  console.error("Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL env vars.");
  process.exit(1);
}
if (SOURCE_URL === TARGET_URL) {
  console.error("SOURCE and TARGET are identical — refusing to run.");
  process.exit(1);
}

const src = new PrismaClient({ datasources: { db: { url: SOURCE_URL } } });
const dst = new PrismaClient({ datasources: { db: { url: TARGET_URL } } });

// Delegate name -> Prisma model accessor. Order matters: parents before children.
const ORDER = [
  "user",
  "account",
  "session",
  "verificationToken",
  "entity",
  "plaidItem",
  "squareConnection",
  "financialAccount",
  "plaidAccount",
  "category",
  "vendor",
  "item",
  "transaction",
  "transactionSplit",
  "transactionLink",
  "receipt",
  "lineItem",
  "receiptTransaction",
  "classificationRule",
  "backgroundJob",
] as const;

function delegate(client: PrismaClient, name: string): any {
  return (client as any)[name];
}

async function copyTable(name: string) {
  const total = await delegate(src, name).count();
  if (total === 0) {
    console.log(`  ${name.padEnd(20)} 0 rows — skip`);
    return { name, total: 0, copied: 0 };
  }
  if (!RUN) {
    console.log(`  ${name.padEnd(20)} ${total} rows (dry run)`);
    return { name, total, copied: 0 };
  }

  let copied = 0;
  let skip = 0;
  // Cursor-free paging via skip/take is fine for one-off migration sizes here.
  // Sort by a stable key if present; fall back to default ordering.
  for (;;) {
    const rows = await delegate(src, name).findMany({ skip, take: BATCH });
    if (rows.length === 0) break;
    const res = await delegate(dst, name).createMany({ data: rows, skipDuplicates: true });
    copied += res.count;
    skip += rows.length;
    process.stdout.write(`\r  ${name.padEnd(20)} ${skip}/${total} read, ${copied} inserted`);
  }
  process.stdout.write("\n");
  return { name, total, copied };
}

async function main() {
  console.log(RUN ? "=== MIGRATION (writing) ===" : "=== DRY RUN (no writes) ===");
  console.log("source:", SOURCE_URL!.replace(/:[^:@/]+@/, ":****@"));
  console.log("target:", TARGET_URL!.replace(/:[^:@/]+@/, ":****@"));

  // Safety: refuse to write into a non-empty target unless forced.
  if (RUN) {
    const targetUsers = await dst.user.count();
    const targetTx = await dst.transaction.count();
    if ((targetUsers > 0 || targetTx > 0) && !process.argv.includes("--force")) {
      console.error(`\nTarget is NOT empty (users=${targetUsers}, transactions=${targetTx}).`);
      console.error("skipDuplicates makes this safe-ish, but pass --force to proceed intentionally.");
      process.exit(1);
    }
  }

  console.log("");
  const results = [];
  for (const name of ORDER) {
    results.push(await copyTable(name));
  }

  console.log("\n=== SUMMARY ===");
  let allMatch = true;
  for (const r of results) {
    const tgt = RUN ? await delegate(dst, r.name).count() : 0;
    const ok = !RUN || tgt === r.total;
    if (!ok) allMatch = false;
    console.log(
      `  ${r.name.padEnd(20)} source=${r.total}${RUN ? ` target=${tgt} ${ok ? "✓" : "✗ MISMATCH"}` : ""}`
    );
  }
  if (RUN) console.log(allMatch ? "\nAll tables match. ✅" : "\nSome tables mismatch — investigate. ⚠️");
  else console.log("\nDry run complete. Re-run with --run to copy.");
}

main()
  .catch((e) => { console.error("\nFATAL:", e.message); process.exit(1); })
  .finally(async () => { await src.$disconnect(); await dst.$disconnect(); });
