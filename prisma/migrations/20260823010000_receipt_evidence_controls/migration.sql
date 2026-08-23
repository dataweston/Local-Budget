-- Durable receipt identity and recoverable deletion. Legacy rows remain valid
-- with a null content hash until their original file is re-observed.
ALTER TABLE "receipts"
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "receipts_userId_contentHash_key"
  ON "receipts"("userId", "contentHash");
CREATE INDEX "receipts_userId_deletedAt_idx"
  ON "receipts"("userId", "deletedAt");

-- Tax/source evidence is recoverable by default. Physical deletion requires a
-- separately reviewed retention operation outside normal application paths.
CREATE OR REPLACE FUNCTION prevent_receipt_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'receipt evidence must be retired with deletedAt, not deleted';
END;
$$;
CREATE TRIGGER receipts_no_hard_delete
  BEFORE DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION prevent_receipt_delete();
