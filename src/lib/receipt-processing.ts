import { db } from '@/lib/db';
import { processReceiptDocument } from '@/lib/ocr';
import { normalizeVendorName } from '@/lib/normalization/vendors';

const KIND_TO_LINE_TYPE: Record<string, 'ITEM' | 'SHIPPING' | 'FEE' | 'TAX' | 'TIP' | 'DISCOUNT' | 'OTHER'> = {
  item: 'ITEM',
  shipping: 'SHIPPING',
  fee: 'FEE',
  tax: 'TAX',
  tip: 'TIP',
  discount: 'DISCOUNT',
  other: 'OTHER',
};

// Resolve (or create) a catalog Item so ingredient units/prices accumulate
// across receipts — the basis for the brain's recipe costing and price drift.
async function resolveItemId(name: string, unitOfMeasure?: string): Promise<string | null> {
  const normalized = normalizeVendorName(name).toLowerCase();
  if (!normalized) return null;
  const existing = await db.item.findFirst({ where: { normalizedName: normalized }, select: { id: true } });
  if (existing) {
    if (unitOfMeasure) {
      await db.item.update({ where: { id: existing.id }, data: { unitOfMeasure } });
    }
    return existing.id;
  }
  const created = await db.item.create({
    data: { name, normalizedName: normalized, unitOfMeasure: unitOfMeasure ?? null },
    select: { id: true },
  });
  return created.id;
}

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

    // Build structured line items: lineType enum, quantity, unitPrice, and a
    // linked catalog Item (carrying unit of measure) instead of a text prefix.
    const lineItems: Array<{
      receiptId: string;
      description: string;
      totalPrice: number;
      quantity: number | null;
      unitPrice: number | null;
      lineType: 'ITEM' | 'SHIPPING' | 'FEE' | 'TAX' | 'TIP' | 'DISCOUNT' | 'OTHER';
      classification: 'COGS' | 'OPERATING' | 'PERSONAL' | null;
      itemId: string | null;
    }> = [];

    for (const item of ocrResult.items ?? []) {
      const rawPrice = typeof item.price === 'number' ? Math.abs(item.price) : 0;
      if (rawPrice <= 0) continue;
      const lineType = KIND_TO_LINE_TYPE[item.kind ?? 'item'] ?? 'ITEM';
      // Only ITEM lines become catalog items (fees/tax/tip are not ingredients).
      const itemId =
        lineType === 'ITEM' ? await resolveItemId(item.name, item.unitOfMeasure) : null;
      lineItems.push({
        receiptId: input.receiptId,
        description: item.name.slice(0, 500),
        totalPrice: rawPrice,
        quantity: typeof item.quantity === 'number' ? item.quantity : null,
        unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : null,
        lineType,
        classification: item.classificationHint ?? null,
        itemId,
      });
    }

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
