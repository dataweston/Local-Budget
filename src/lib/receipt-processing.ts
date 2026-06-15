import { db } from '@/lib/db';
import { processReceiptDocument } from '@/lib/ocr';

type RunReceiptOcrInput = {
  receiptId: string;
  buffer: Buffer;
  mimeType: string;
  /** Existing extractedData (storage/email metadata) to merge OCR results into. */
  baseExtractedData?: Record<string, unknown>;
};

export type ReceiptOcrResult = Awaited<ReturnType<typeof processReceiptDocument>>;

/**
 * Run OCR for a stored receipt and persist the results (receipt fields +
 * line items). Marks the receipt FAILED when OCR throws; rethrows so callers
 * can react (job retry, HTTP warning).
 */
export async function runReceiptOcr(input: RunReceiptOcrInput): Promise<ReceiptOcrResult> {
  try {
    const ocrResult = await processReceiptDocument({
      buffer: input.buffer,
      mimeType: input.mimeType,
    });

    const lineItems = (ocrResult.items ?? [])
      .map((item) => {
        const rawPrice = typeof item.price === 'number' ? Math.abs(item.price) : 0;
        if (rawPrice <= 0) return null;
        const prefix =
          item.kind && item.kind !== 'item'
            ? `[${item.kind.charAt(0).toUpperCase()}${item.kind.slice(1)}] `
            : '';
        return {
          receiptId: input.receiptId,
          description: `${prefix}${item.name}`.slice(0, 500),
          totalPrice: rawPrice,
          classification: item.classificationHint ?? null,
        };
      })
      .filter((item): item is {
        receiptId: string;
        description: string;
        totalPrice: number;
        classification: 'COGS' | 'OPERATING' | 'PERSONAL' | null;
      } => !!item);

    await db.receipt.update({
      where: { id: input.receiptId },
      data: {
        status: 'PROCESSED',
        vendorName: ocrResult.vendorName,
        totalAmount: ocrResult.totalAmount,
        subtotal: ocrResult.subtotal,
        tax: ocrResult.tax,
        tip: ocrResult.tip,
        receiptDate: ocrResult.date,
        rawOcrText: ocrResult.rawText,
        ocrConfidence: ocrResult.confidence,
        extractedData: {
          ...(input.baseExtractedData ?? {}),
          items: ocrResult.items,
          paymentMethod: ocrResult.paymentMethod,
          lastFourDigits: ocrResult.lastFourDigits,
        },
      },
    });

    if (lineItems.length > 0) {
      await db.lineItem.createMany({ data: lineItems });
    }

    return ocrResult;
  } catch (error) {
    await db.receipt.update({
      where: { id: input.receiptId },
      data: {
        status: 'FAILED',
        notes: `OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    });
    throw error;
  }
}

/**
 * Queue a background OCR job for a receipt. The cron-driven worker at
 * /api/jobs/process-receipts picks these up.
 */
export async function enqueueReceiptOcrJob(receiptId: string): Promise<void> {
  await db.backgroundJob.create({
    data: {
      type: 'ocr_receipt',
      status: 'PENDING',
      payload: { receiptId },
    },
  });
}
