-- Expand transaction lifecycle without destroying provider history.
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'REMOVED';
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'REVERSED';
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

-- Keep reconciliation state independent from matching method.
CREATE TYPE "ReconciliationStatus" AS ENUM ('UNMATCHED', 'PARTIAL', 'MATCHED', 'EXCLUDED');
CREATE TYPE "ReconciliationMethod" AS ENUM ('AUTO', 'MANUAL', 'IMPORTED');

ALTER TABLE "financial_accounts"
ADD COLUMN "openingBalance" DECIMAL(19,4),
ADD COLUMN "openingBalanceDate" TIMESTAMP(3);

ALTER TABLE "transactions"
ADD COLUMN "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
ADD COLUMN "reconciliationMethod" "ReconciliationMethod",
ADD COLUMN "reconciledAt" TIMESTAMP(3),
ADD COLUMN "removedAt" TIMESTAMP(3);

-- Preserve prior reviewed reconciliation decisions. The legacy column remains
-- physically present for one expand/contract deployment cycle so the migration
-- cannot break an older application instance during a rolling deployment.
UPDATE "transactions"
SET "reconciliationStatus" = 'MATCHED',
    "reconciliationMethod" = 'MANUAL',
    "reconciledAt" = "updatedAt"
WHERE "isReconciled" = true;

CREATE TABLE "transaction_source_identities" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceAccountId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "transaction_source_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processor_settlements" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "transactionId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "arrivalDate" TIMESTAMP(3),
    "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "reconciledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "processor_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processor_settlement_entries" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "providerEntryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "grossAmount" DECIMAL(19,4) NOT NULL,
    "feeAmount" DECIMAL(19,4) NOT NULL,
    "netAmount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentExternalId" TEXT,
    "refundExternalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "processor_settlement_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_allocations" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "settlementId" TEXT,
    "settlementEntryId" TEXT,
    "externalSystem" TEXT NOT NULL,
    "externalObjectType" TEXT NOT NULL,
    "externalObjectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" "ReconciliationMethod" NOT NULL,
    "confidence" DECIMAL(5,4),
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reconciliation_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "account_balance_snapshots" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "balance" DECIMAL(19,4) NOT NULL,
    "availableBalance" DECIMAL(19,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "externalSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_balance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financial_audit_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "transactionId" TEXT,
    "financialAccountId" TEXT,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "changedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transaction_source_identities_sourceSystem_sourceAccountId_externalId_key"
ON "transaction_source_identities"("sourceSystem", "sourceAccountId", "externalId");
CREATE INDEX "transaction_source_identities_transactionId_idx" ON "transaction_source_identities"("transactionId");
CREATE INDEX "transaction_source_identities_sourceSystem_sourceAccountId_idx" ON "transaction_source_identities"("sourceSystem", "sourceAccountId");

CREATE UNIQUE INDEX "processor_settlements_transactionId_key" ON "processor_settlements"("transactionId");
CREATE UNIQUE INDEX "processor_settlements_accountId_provider_externalId_key" ON "processor_settlements"("accountId", "provider", "externalId");
CREATE INDEX "processor_settlements_provider_externalId_idx" ON "processor_settlements"("provider", "externalId");
CREATE INDEX "processor_settlements_effectiveAt_idx" ON "processor_settlements"("effectiveAt");

CREATE UNIQUE INDEX "processor_settlement_entries_settlementId_providerEntryId_key" ON "processor_settlement_entries"("settlementId", "providerEntryId");
CREATE INDEX "processor_settlement_entries_paymentExternalId_idx" ON "processor_settlement_entries"("paymentExternalId");
CREATE INDEX "processor_settlement_entries_refundExternalId_idx" ON "processor_settlement_entries"("refundExternalId");

CREATE UNIQUE INDEX "reconciliation_allocations_transactionId_externalSystem_externalObjectType_externalObjectId_role_key"
ON "reconciliation_allocations"("transactionId", "externalSystem", "externalObjectType", "externalObjectId", "role");
CREATE INDEX "reconciliation_allocations_userId_idx" ON "reconciliation_allocations"("userId");
CREATE INDEX "reconciliation_allocations_settlementId_idx" ON "reconciliation_allocations"("settlementId");
CREATE INDEX "reconciliation_allocations_settlementEntryId_idx" ON "reconciliation_allocations"("settlementEntryId");

CREATE UNIQUE INDEX "account_balance_snapshots_accountId_source_effectiveAt_key" ON "account_balance_snapshots"("accountId", "source", "effectiveAt");
CREATE INDEX "account_balance_snapshots_accountId_effectiveAt_idx" ON "account_balance_snapshots"("accountId", "effectiveAt");

CREATE INDEX "financial_audit_events_userId_createdAt_idx" ON "financial_audit_events"("userId", "createdAt");
CREATE INDEX "financial_audit_events_transactionId_idx" ON "financial_audit_events"("transactionId");
CREATE INDEX "financial_audit_events_financialAccountId_idx" ON "financial_audit_events"("financialAccountId");

ALTER TABLE "transaction_source_identities" ADD CONSTRAINT "transaction_source_identities_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "processor_settlements" ADD CONSTRAINT "processor_settlements_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "processor_settlements" ADD CONSTRAINT "processor_settlements_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "processor_settlement_entries" ADD CONSTRAINT "processor_settlement_entries_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "processor_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_allocations" ADD CONSTRAINT "reconciliation_allocations_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_allocations" ADD CONSTRAINT "reconciliation_allocations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_allocations" ADD CONSTRAINT "reconciliation_allocations_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "processor_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reconciliation_allocations" ADD CONSTRAINT "reconciliation_allocations_settlementEntryId_fkey"
FOREIGN KEY ("settlementEntryId") REFERENCES "processor_settlement_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_financialAccountId_fkey"
FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill known provider identities without assuming provider IDs are globally unique.
INSERT INTO "transaction_source_identities" (
    "id", "transactionId", "sourceSystem", "externalId", "sourceAccountId", "isCurrent", "firstSeenAt", "lastSeenAt"
)
SELECT
    'tsi_' || md5(t."id" || ':' || t."externalId"),
    t."id",
    CASE
      WHEN t."externalId" LIKE 'square_%' THEN 'SQUARE'
      WHEN fa."plaidAccountId" IS NOT NULL THEN 'PLAID'
      ELSE 'LEGACY'
    END,
    t."externalId",
    COALESCE(fa."plaidAccountId", t."accountId"),
    t."status" NOT IN ('CANCELLED'),
    t."createdAt",
    t."updatedAt"
FROM "transactions" t
JOIN "financial_accounts" fa ON fa."id" = t."accountId"
WHERE t."externalId" IS NOT NULL
ON CONFLICT DO NOTHING;
