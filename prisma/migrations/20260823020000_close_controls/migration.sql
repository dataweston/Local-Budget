CREATE TYPE "CloseRunStatus" AS ENUM ('DRAFT', 'BLOCKED', 'READY', 'CLOSED');

CREATE TABLE "close_runs" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "status" "CloseRunStatus" NOT NULL DEFAULT 'DRAFT',
  "preparedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "metrics" JSONB NOT NULL,
  "blockers" JSONB NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "close_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "close_runs_periodId_status_createdAt_idx"
  ON "close_runs"("periodId", "status", "createdAt");
CREATE INDEX "close_runs_preparedById_idx" ON "close_runs"("preparedById");

ALTER TABLE "close_runs" ADD CONSTRAINT "close_runs_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "close_runs" ADD CONSTRAINT "close_runs_preparedById_fkey"
  FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "close_runs" ADD CONSTRAINT "close_runs_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_closed_close_run_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'closed close runs are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'closed close runs are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER close_runs_immutable_after_close
  BEFORE UPDATE OR DELETE ON "close_runs"
  FOR EACH ROW EXECUTE FUNCTION prevent_closed_close_run_mutation();
