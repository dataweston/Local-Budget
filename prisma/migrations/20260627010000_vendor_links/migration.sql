-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "vendorId" TEXT;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "defaultClassification" "ClassificationType";

-- CreateIndex
CREATE INDEX "transactions_vendorId_idx" ON "transactions"("vendorId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
