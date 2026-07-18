import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  const hasVendorIdCol = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'vendorId'`;
  const colExists = Number(hasVendorIdCol[0].count) > 0;
  if (!colExists) {
    console.log(JSON.stringify({ migrationApplied: false }));
    return;
  }

  const migrations = await db.$queryRaw<{ name: string }[]>`
    SELECT migration_name AS name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  const vendorCount = await db.vendor.count();
  const txTotal = await db.transaction.count();
  const txLinked = await db.transaction.count({ where: { vendorId: { not: null } } });
  const cogsOps = await db.$queryRaw<{ total: bigint; linked: bigint }[]>`
    SELECT count(*)::bigint AS total,
           count(*) FILTER (WHERE t."vendorId" IS NOT NULL)::bigint AS linked
    FROM transactions t
    LEFT JOIN categories c ON c.id = t."categoryId"
    WHERE COALESCE(t.classification::text, c."defaultClassification"::text) IN ('COGS','OPERATING')`;
  const spotChecks = await db.$queryRaw<
    { merchantName: string; vendorId: string | null; vendorName: string | null; n: bigint }[]
  >`
    SELECT t."merchantName", t."vendorId", v.name AS "vendorName", count(*)::bigint AS n
    FROM transactions t LEFT JOIN vendors v ON v.id = t."vendorId"
    WHERE t."merchantName" ILIKE '%eastside%' OR t."merchantName" ILIKE '%costco%' OR t."merchantName" ILIKE '%amazon%'
    GROUP BY 1, 2, 3 ORDER BY t."merchantName"`;

  console.log(JSON.stringify({
    migrationApplied: true,
    appliedMigrations: migrations.map((m) => m.name),
    vendorCount,
    txLinked: `${txLinked}/${txTotal}`,
    cogsOperatingLinked: `${Number(cogsOps[0].linked)}/${Number(cogsOps[0].total)}`,
    spotChecks: spotChecks.map((r) => ({ ...r, n: Number(r.n) })),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
