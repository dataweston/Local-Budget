-- Additive accounting core. No legacy rows are backfilled by this migration.

CREATE TYPE "CustodyRole" AS ENUM ('BUSINESS', 'PERSONAL', 'PROCESSOR', 'SHARED', 'UNKNOWN');
CREATE TYPE "AccountOwnershipRole" AS ENUM ('SOLE_OWNER', 'JOINT_OWNER', 'CUSTODIAN', 'AUTHORIZED_SIGNER');
CREATE TYPE "SourceEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "ChartAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE', 'CONTRA_ASSET');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'REVIEW', 'CLOSED');
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

ALTER TABLE "financial_accounts"
  ADD COLUMN "custodyRole" "CustodyRole" NOT NULL DEFAULT 'UNKNOWN';

CREATE TABLE "financial_account_owners" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "role" "AccountOwnershipRole" NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "sourceRef" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_account_owners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_account_owners_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "source_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceNamespace" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventVersion" TEXT NOT NULL DEFAULT '1',
  "occurredAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB,
  "payloadUri" TEXT,
  "signatureStatus" TEXT,
  "parserVersion" TEXT,
  "status" "SourceEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "processingError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "source_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chart_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "ChartAccountType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chart_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_periods" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_periods_range_check" CHECK ("endsAt" > "startsAt")
);

CREATE TABLE "journal_entries" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "entryDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "sourceEventId" TEXT,
  "reversalOfId" TEXT,
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_entries_not_self_reversal_check" CHECK ("reversalOfId" IS NULL OR "reversalOfId" <> "id")
);

CREATE TABLE "journal_lines" (
  "id" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "chartAccountId" TEXT NOT NULL,
  "description" TEXT,
  "debitAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "creditAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "legalOwnerId" TEXT,
  "custodyAccountId" TEXT,
  "taxCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_lines_nonnegative_check" CHECK ("debitAmount" >= 0 AND "creditAmount" >= 0),
  CONSTRAINT "journal_lines_one_sided_check" CHECK (("debitAmount" > 0 AND "creditAmount" = 0) OR ("creditAmount" > 0 AND "debitAmount" = 0))
);

CREATE UNIQUE INDEX "source_events_userId_sourceSystem_sourceNamespace_externalId_key"
  ON "source_events"("userId", "sourceSystem", "sourceNamespace", "externalId");
CREATE INDEX "source_events_userId_sourceSystem_sourceNamespace_idx"
  ON "source_events"("userId", "sourceSystem", "sourceNamespace");
CREATE INDEX "source_events_status_receivedAt_idx"
  ON "source_events"("status", "receivedAt");

CREATE UNIQUE INDEX "chart_accounts_userId_code_key"
  ON "chart_accounts"("userId", "code");
CREATE INDEX "chart_accounts_userId_type_idx"
  ON "chart_accounts"("userId", "type");

CREATE UNIQUE INDEX "accounting_periods_userId_startsAt_endsAt_key"
  ON "accounting_periods"("userId", "startsAt", "endsAt");
CREATE INDEX "accounting_periods_userId_status_startsAt_endsAt_idx"
  ON "accounting_periods"("userId", "status", "startsAt", "endsAt");

CREATE INDEX "journal_entries_userId_entryDate_idx"
  ON "journal_entries"("userId", "entryDate");
CREATE INDEX "journal_entries_periodId_status_idx"
  ON "journal_entries"("periodId", "status");
CREATE INDEX "journal_entries_sourceEventId_idx"
  ON "journal_entries"("sourceEventId");
CREATE UNIQUE INDEX "journal_entries_reversalOfId_key"
  ON "journal_entries"("reversalOfId");
CREATE INDEX "journal_lines_journalEntryId_idx"
  ON "journal_lines"("journalEntryId");
CREATE INDEX "journal_lines_chartAccountId_idx"
  ON "journal_lines"("chartAccountId");
CREATE INDEX "journal_lines_legalOwnerId_custodyAccountId_idx"
  ON "journal_lines"("legalOwnerId", "custodyAccountId");
CREATE INDEX "financial_accounts_userId_custodyRole_idx"
  ON "financial_accounts"("userId", "custodyRole");
CREATE UNIQUE INDEX "financial_account_owners_accountId_entityId_role_key"
  ON "financial_account_owners"("accountId", "entityId", "role");
CREATE INDEX "financial_account_owners_entityId_role_idx"
  ON "financial_account_owners"("entityId", "role");

ALTER TABLE "financial_account_owners" ADD CONSTRAINT "financial_account_owners_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_account_owners" ADD CONSTRAINT "financial_account_owners_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_sourceEventId_fkey"
  FOREIGN KEY ("sourceEventId") REFERENCES "source_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_chartAccountId_fkey"
  FOREIGN KEY ("chartAccountId") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_legalOwnerId_fkey"
  FOREIGN KEY ("legalOwnerId") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_custodyAccountId_fkey"
  FOREIGN KEY ("custodyAccountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Source identity/evidence fields cannot be edited or deleted. Processing
-- status/error metadata remains mutable so retries can be recorded safely.
CREATE OR REPLACE FUNCTION prevent_source_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source events are immutable';
  END IF;
  IF ROW(NEW."userId", NEW."sourceSystem", NEW."sourceNamespace", NEW."externalId",
         NEW."eventType", NEW."eventVersion", NEW."occurredAt", NEW."settledAt",
         NEW."receivedAt", NEW."payloadHash", NEW."payload", NEW."payloadUri",
         NEW."signatureStatus", NEW."parserVersion") IS DISTINCT FROM
     ROW(OLD."userId", OLD."sourceSystem", OLD."sourceNamespace", OLD."externalId",
         OLD."eventType", OLD."eventVersion", OLD."occurredAt", OLD."settledAt",
         OLD."receivedAt", OLD."payloadHash", OLD."payload", OLD."payloadUri",
         OLD."signatureStatus", OLD."parserVersion") THEN
    RAISE EXCEPTION 'source event evidence and identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_events_immutable
  BEFORE UPDATE OR DELETE ON "source_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_source_event_mutation();

-- Posted entries and entries in closed periods cannot be changed or removed.
CREATE OR REPLACE FUNCTION prevent_posted_journal_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_status "JournalEntryStatus";
  period_status "AccountingPeriodStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT e."status", p."status" INTO entry_status, period_status
    FROM "journal_entries" e
    JOIN "accounting_periods" p ON p."id" = e."periodId"
    WHERE e."id" = OLD."journalEntryId";
  ELSE
    SELECT e."status", p."status" INTO entry_status, period_status
    FROM "journal_entries" e
    JOIN "accounting_periods" p ON p."id" = e."periodId"
    WHERE e."id" = NEW."journalEntryId";
  END IF;
  IF entry_status IN ('POSTED', 'REVERSED') OR period_status = 'CLOSED' THEN
    RAISE EXCEPTION 'posted or closed journal entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_lines_immutable_after_post
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_mutation();

CREATE OR REPLACE FUNCTION prevent_posted_journal_entry_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period_status "AccountingPeriodStatus";
BEGIN
  SELECT "status" INTO period_status
  FROM "accounting_periods"
  WHERE "id" = OLD."periodId";
  IF OLD."status" IN ('POSTED', 'REVERSED') OR period_status = 'CLOSED' THEN
    RAISE EXCEPTION 'posted or closed journal entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_entries_immutable_after_post
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_entry_mutation();

-- A reversal can only point to one of the same tenant's posted entries. The
-- unique index above permits only one linked reversal per original entry.
CREATE OR REPLACE FUNCTION validate_journal_reversal_target() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original_user_id TEXT;
  original_status "JournalEntryStatus";
BEGIN
  IF NEW."reversalOfId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "userId", "status" INTO original_user_id, original_status
  FROM "journal_entries" WHERE "id" = NEW."reversalOfId";
  IF NOT FOUND OR original_user_id <> NEW."userId" OR original_status <> 'POSTED' THEN
    RAISE EXCEPTION 'reversal target must be a posted entry owned by the same user';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_entries_validate_reversal_target
  BEFORE INSERT OR UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION validate_journal_reversal_target();

CREATE OR REPLACE FUNCTION validate_posted_journal_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit_total NUMERIC;
  credit_total NUMERIC;
  line_count INTEGER;
  period_status "AccountingPeriodStatus";
BEGIN
  SELECT "status" INTO period_status FROM "accounting_periods" WHERE "id" = NEW."periodId";
  IF NEW."status" IN ('POSTED', 'REVERSED') THEN
    IF period_status = 'CLOSED' THEN
      RAISE EXCEPTION 'cannot post or reverse an entry in a closed period';
    END IF;
    SELECT COUNT(*), COALESCE(SUM("debitAmount"), 0), COALESCE(SUM("creditAmount"), 0)
      INTO line_count, debit_total, credit_total
      FROM "journal_lines" WHERE "journalEntryId" = NEW."id";
    IF line_count = 0 OR debit_total <> credit_total THEN
      RAISE EXCEPTION 'journal entry must have balanced lines before posting';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_entries_validate_posted
  BEFORE INSERT OR UPDATE OF "status" ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION validate_posted_journal_entry();

CREATE OR REPLACE FUNCTION prevent_closed_period_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'closed accounting periods are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accounting_periods_immutable_after_close
  BEFORE UPDATE ON "accounting_periods"
  FOR EACH ROW EXECUTE FUNCTION prevent_closed_period_mutation();
