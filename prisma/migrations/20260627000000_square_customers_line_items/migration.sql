-- CreateEnum
CREATE TYPE "LineItemType" AS ENUM ('ITEM', 'SHIPPING', 'FEE', 'TAX', 'TIP', 'DISCOUNT', 'OTHER');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "squareCustomerId" TEXT;

-- AlterTable
ALTER TABLE "line_items" ADD COLUMN     "lineType" "LineItemType" NOT NULL DEFAULT 'ITEM',
ADD COLUMN     "sourceUid" TEXT;

-- CreateTable
CREATE TABLE "square_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "squareConnectionId" TEXT NOT NULL,
    "squareCustomerId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "companyName" TEXT,
    "firstSeen" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "square_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "square_customers_userId_idx" ON "square_customers"("userId");

-- CreateIndex
CREATE INDEX "square_customers_email_idx" ON "square_customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "square_customers_squareConnectionId_squareCustomerId_key" ON "square_customers"("squareConnectionId", "squareCustomerId");

-- CreateIndex
CREATE INDEX "transactions_squareCustomerId_idx" ON "transactions"("squareCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "line_items_transactionId_sourceUid_key" ON "line_items"("transactionId", "sourceUid");

-- AddForeignKey
ALTER TABLE "square_customers" ADD CONSTRAINT "square_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "square_customers" ADD CONSTRAINT "square_customers_squareConnectionId_fkey" FOREIGN KEY ("squareConnectionId") REFERENCES "square_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_squareCustomerId_fkey" FOREIGN KEY ("squareCustomerId") REFERENCES "square_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
