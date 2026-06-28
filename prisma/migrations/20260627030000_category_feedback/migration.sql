-- CreateTable
CREATE TABLE "category_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "descriptionKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "wasCorrection" BOOLEAN NOT NULL DEFAULT false,
    "timesConfirmed" INTEGER NOT NULL DEFAULT 1,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_feedback_userId_merchantKey_idx" ON "category_feedback"("userId", "merchantKey");

-- CreateIndex
CREATE UNIQUE INDEX "category_feedback_userId_merchantKey_descriptionKey_type_ca_key" ON "category_feedback"("userId", "merchantKey", "descriptionKey", "type", "categoryId");

-- AddForeignKey
ALTER TABLE "category_feedback" ADD CONSTRAINT "category_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_feedback" ADD CONSTRAINT "category_feedback_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
