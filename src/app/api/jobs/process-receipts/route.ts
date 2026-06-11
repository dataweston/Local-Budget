import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readReceiptFile } from '@/lib/receipt-storage';
import { runReceiptOcr } from '@/lib/receipt-processing';
import { authorizeServiceRequest } from '@/lib/service-auth';

export const maxDuration = 300;

const BATCH_SIZE = 5;

/**
 * Cron-driven worker for queued `ocr_receipt` background jobs.
 * Vercel Cron calls this with `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(req, process.env.CRON_SECRET, 'CRON_SECRET');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const jobs = await db.backgroundJob.findMany({
    where: {
      type: 'ocr_receipt',
      status: 'PENDING',
      scheduledAt: { lte: new Date() },
    },
    orderBy: { scheduledAt: 'asc' },
    take: BATCH_SIZE,
  });

  const results: { jobId: string; receiptId: string | null; status: string }[] = [];

  for (const job of jobs) {
    const payload = (job.payload ?? {}) as { receiptId?: string };
    const receiptId = payload.receiptId ?? null;

    // Claim the job; updateMany guards against a concurrent worker run.
    const claimed = await db.backgroundJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    try {
      if (!receiptId) {
        throw new Error('Job payload is missing receiptId');
      }

      const receipt = await db.receipt.findUnique({ where: { id: receiptId } });
      if (!receipt) {
        throw new Error(`Receipt ${receiptId} not found`);
      }

      const buffer = await readReceiptFile(receipt.filePath);
      const baseExtractedData =
        receipt.extractedData && typeof receipt.extractedData === 'object'
          ? (receipt.extractedData as Record<string, unknown>)
          : {};

      await runReceiptOcr({
        receiptId,
        buffer,
        mimeType: receipt.fileType,
        baseExtractedData,
      });

      await db.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: { receiptId, outcome: 'processed' },
        },
      });
      results.push({ jobId: job.id, receiptId, status: 'COMPLETED' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const attemptsUsed = job.attempts + 1;
      const exhausted = attemptsUsed >= job.maxAttempts;

      await db.backgroundJob.update({
        where: { id: job.id },
        data: exhausted
          ? { status: 'FAILED', completedAt: new Date(), error: message }
          : {
              status: 'PENDING',
              error: message,
              // Back off before the next worker run retries it.
              scheduledAt: new Date(Date.now() + 10 * 60 * 1000),
            },
      });
      results.push({ jobId: job.id, receiptId, status: exhausted ? 'FAILED' : 'RETRY' });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
