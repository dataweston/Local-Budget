import { Worker, Job } from 'bullmq';
import { connection, JobPayload } from './queues';
import { db } from '@/lib/db';

console.log('🚀 Starting Local Budget background workers...');

// Bank Sync Worker
const syncWorker = new Worker(
  'bank-sync',
  async (job: Job) => {
    const data = job.data as JobPayload;
    if (data.type !== 'bank-sync') return;

    console.log(`📦 Processing bank sync for item: ${data.plaidItemId}`);

    try {
      // TODO: Implement Plaid sync logic
      // 1. Get access token for plaidItemId
      // 2. Fetch transactions from Plaid
      // 3. Upsert transactions into database
      // 4. Update account balances
      // 5. Update lastSyncedAt

      await db.plaidItem.update({
        where: { itemId: data.plaidItemId },
        data: { lastSyncedAt: new Date() },
      });

      console.log(`✅ Bank sync complete for item: ${data.plaidItemId}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Bank sync failed:`, error);
      throw error;
    }
  },
  { connection }
);

// Receipt OCR Worker
const ocrWorker = new Worker(
  'receipt-ocr',
  async (job: Job) => {
    const data = job.data as JobPayload;
    if (data.type !== 'receipt-ocr') return;

    console.log(`🔍 Processing OCR for receipt: ${data.receiptId}`);

    try {
      // Update status to processing
      await db.receipt.update({
        where: { id: data.receiptId },
        data: { status: 'PROCESSING' },
      });

      // TODO: Implement OCR logic
      // 1. Read file from filePath
      // 2. Send to OCR service (Tesseract, Google Vision, etc.)
      // 3. Parse extracted text
      // 4. Extract: vendor, total, date, line items
      // 5. Update receipt with extracted data

      // Placeholder: simulate OCR processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await db.receipt.update({
        where: { id: data.receiptId },
        data: {
          status: 'PROCESSED',
          // extractedData would be populated here
        },
      });

      console.log(`✅ OCR complete for receipt: ${data.receiptId}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ OCR failed:`, error);

      await db.receipt.update({
        where: { id: data.receiptId },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  },
  { connection }
);

// Classification Rules Worker
const rulesWorker = new Worker(
  'apply-rules',
  async (job: Job) => {
    const data = job.data as JobPayload;
    if (data.type !== 'apply-rules') return;

    console.log(`📋 Applying rules to ${data.transactionIds.length} transactions`);

    try {
      // Get active rules for user
      const rules = await db.classificationRule.findMany({
        where: {
          userId: data.userId,
          isActive: true,
        },
        orderBy: { priority: 'desc' },
      });

      // Get transactions to process
      const transactions = await db.transaction.findMany({
        where: { id: { in: data.transactionIds } },
      });

      let appliedCount = 0;

      for (const tx of transactions) {
        for (const rule of rules) {
          let matches = false;
          const fieldValue = (tx as any)[rule.matchField]?.toLowerCase() || '';
          const matchValue = rule.matchValue.toLowerCase();

          switch (rule.matchType) {
            case 'EXACT':
              matches = fieldValue === matchValue;
              break;
            case 'CONTAINS':
              matches = fieldValue.includes(matchValue);
              break;
            case 'STARTS_WITH':
              matches = fieldValue.startsWith(matchValue);
              break;
            case 'REGEX':
              try {
                matches = new RegExp(rule.matchValue, 'i').test(fieldValue);
              } catch {
                matches = false;
              }
              break;
          }

          if (matches) {
            await db.transaction.update({
              where: { id: tx.id },
              data: {
                ...(rule.categoryId && { categoryId: rule.categoryId }),
                ...(rule.classification && { classification: rule.classification }),
                ...(rule.incurredById && { incurredById: rule.incurredById }),
              },
            });

            await db.classificationRule.update({
              where: { id: rule.id },
              data: {
                timesApplied: { increment: 1 },
                lastAppliedAt: new Date(),
              },
            });

            appliedCount++;
            break; // First matching rule wins
          }
        }
      }

      console.log(`✅ Applied rules to ${appliedCount} transactions`);
      return { success: true, appliedCount };
    } catch (error) {
      console.error(`❌ Rules application failed:`, error);
      throw error;
    }
  },
  { connection }
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down workers...');
  await syncWorker.close();
  await ocrWorker.close();
  await rulesWorker.close();
  process.exit(0);
});

console.log('✅ Workers started and listening for jobs');
