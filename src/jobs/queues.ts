import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

// Redis connection
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Define queues
export const syncQueue = new Queue('bank-sync', { connection });
export const ocrQueue = new Queue('receipt-ocr', { connection });
export const rulesQueue = new Queue('apply-rules', { connection });

// Job types
export interface BankSyncJob {
  type: 'bank-sync';
  plaidItemId: string;
  userId: string;
}

export interface ReceiptOcrJob {
  type: 'receipt-ocr';
  receiptId: string;
  filePath: string;
}

export interface ApplyRulesJob {
  type: 'apply-rules';
  transactionIds: string[];
  userId: string;
}

export type JobPayload = BankSyncJob | ReceiptOcrJob | ApplyRulesJob;

// Helper to add jobs
export async function addBankSyncJob(data: Omit<BankSyncJob, 'type'>) {
  return syncQueue.add('sync', { type: 'bank-sync', ...data });
}

export async function addReceiptOcrJob(data: Omit<ReceiptOcrJob, 'type'>) {
  return ocrQueue.add('ocr', { type: 'receipt-ocr', ...data });
}

export async function addApplyRulesJob(data: Omit<ApplyRulesJob, 'type'>) {
  return rulesQueue.add('rules', { type: 'apply-rules', ...data });
}

// Export connection for workers
export { connection };
