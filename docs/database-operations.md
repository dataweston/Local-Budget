# Database operations

This repository owns the Local Budget PostgreSQL schema and migration history.
Prisma is the ORM and migration tool; Prisma Postgres (or another hosted
PostgreSQL provider) is the database.

## Current migration baseline

`prisma/migrations/20260106225639_aaa/migration.sql` is the initial migration.
It is semantically equivalent to `prisma/schema.prisma` and creates all 20
application tables and 8 enums.

Do not use `prisma db push` on shared, staging, or production databases. Schema
changes must be created here with `pnpm db:migrate`, reviewed, committed, and
applied elsewhere with `pnpm db:deploy`.

## Create a new Prisma Postgres database

1. In Prisma Console, create a permanent Prisma Postgres database.
2. Under **Connect to your database**, generate both connection strings:
   - pooled URL (`pooled.db.prisma.io`) for application traffic;
   - direct URL (`db.prisma.io`) for migrations and admin tools.
3. Copy `.env.example` to `.env` and set:

   ```dotenv
   DATABASE_URL="postgres://...@pooled.db.prisma.io:5432/postgres?sslmode=require"
   DIRECT_URL="postgres://...@db.prisma.io:5432/postgres?sslmode=require"
   ```

4. Initialize and verify the empty database:

   ```bash
   pnpm db:generate
   pnpm db:deploy
   pnpm db:status
   ```

5. Run `pnpm db:seed` only for a disposable development database. It creates
   public demo credentials and must not be run against production.

## Configure Vercel production

The Vercel project needs non-empty values for both URLs:

```bash
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
```

Paste the pooled URL for `DATABASE_URL` and the direct URL for `DIRECT_URL`.
Do not include surrounding quotes in the Vercel value. Remove any empty value
before adding its replacement.

The `vercel-build` script validates both URLs and runs `prisma migrate deploy`
before building Next.js. A deployment now fails instead of publishing an app
with an unconfigured database.

Preview deployments should use a separate preview database. Do not give
untrusted preview branches production database credentials.

## If a populated database already exists

Do not apply the initial migration until drift has been checked. Using its
direct URL, compare the database with the committed schema:

```bash
pnpm exec prisma migrate diff \
  --from-url "$DIRECT_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

Exit code `0` means the structures match. Baseline the existing database once:

```bash
pnpm exec prisma migrate resolve \
  --applied 20260106225639_aaa
pnpm db:status
```

If the diff reports changes, stop and reconcile them before baselining. Marking
a migration as applied without verifying the schema hides drift.

## Share with another repository

Keep one migration owner: this repository. A second repository must not maintain
or deploy an independent migration history against the same database.

For a trusted server-side consumer:

1. Create an environment variable in that repository, for example
   `LOCAL_BUDGET_DATABASE_URL`.
2. Set it to the same **pooled** connection string used here as `DATABASE_URL`.
3. Keep it server-side. Never use a `NEXT_PUBLIC_` variable or expose it to a
   browser bundle.
4. Use the direct URL only for controlled migration/admin jobs owned by this
   repository.

If the consumer uses Prisma, it may introspect and generate a read client, but
it must not run `migrate dev`, `migrate deploy`, or `db push` against this
database.

For a consumer that should not have unrestricted database access, use this
app's `/api/integration/v1/*` endpoints and give the other repository an
`INTEGRATION_API_TOKEN`. This is the safer default because Prisma Postgres
connection credentials grant broad database access.

## Local versus shared development

- Use a dedicated development database when local work may change or delete
  data.
- Point local `.env` at production only for intentional, read-only diagnosis.
- Never commit `.env`, `.env.local`, or connection strings.
- Rotate credentials immediately if a connection string is exposed.
