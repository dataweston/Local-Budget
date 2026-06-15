import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { storeReceiptFile } from '@/lib/receipt-storage';
import { runReceiptOcr } from '@/lib/receipt-processing';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const transactionId = (formData.get('transactionId') as string | null) ?? undefined;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, HEIC, HEIF, PDF' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storeReceiptFile({
      userId: session.user.id,
      originalName: file.name,
      mimeType: file.type,
      buffer,
      source: 'upload',
    });

    // Create receipt record with PROCESSING status
    const receipt = await db.receipt.create({
      data: {
        userId: session.user.id,
        fileName: file.name,
        fileType: stored.fileType,
        filePath: stored.filePath,
        fileSize: stored.fileSize,
        source: 'upload',
        status: 'PROCESSING',
        extractedData: {
          storage: stored.storageMeta,
        },
      },
    });

    if (transactionId) {
      const linkedTx = await db.transaction.findFirst({
        where: {
          id: transactionId,
          account: { userId: session.user.id },
        },
        select: { id: true },
      });
      if (linkedTx) {
        await db.receiptTransaction.create({
          data: {
            receiptId: receipt.id,
            transactionId: linkedTx.id,
            isManual: true,
          },
        });
      }
    }

    // OCR runs synchronously here because the uploader is waiting on the
    // extracted fields in the review modal. Email-sourced receipts go through
    // the background worker instead.
    try {
      const ocrResult = await runReceiptOcr({
        receiptId: receipt.id,
        buffer: stored.ocrBuffer,
        mimeType: file.type,
        baseExtractedData: { storage: stored.storageMeta },
      });

      // Fetch updated receipt
      const updatedReceipt = await db.receipt.findUnique({
        where: { id: receipt.id },
      });

      return NextResponse.json({
        success: true,
        receipt: updatedReceipt,
        parsedData: {
          vendor: ocrResult.vendorName,
          total: ocrResult.totalAmount,
          subtotal: ocrResult.subtotal,
          tax: ocrResult.tax,
          tip: ocrResult.tip,
          date: ocrResult.date?.toISOString(),
          paymentMethod: ocrResult.paymentMethod,
          lineItems: (ocrResult.items ?? []).map((item) => ({
            description: item.name,
            amount: item.price ?? 0,
            kind: item.kind ?? 'item',
          })),
          rawText: ocrResult.rawText,
        },
        ocrResult: {
          confidence: ocrResult.confidence,
          vendorName: ocrResult.vendorName,
          totalAmount: ocrResult.totalAmount,
          date: ocrResult.date,
        },
      });
    } catch (ocrError) {
      // runReceiptOcr already marked the receipt FAILED.
      console.error('OCR processing failed:', ocrError);

      return NextResponse.json({
        success: true,
        receipt: {
          id: receipt.id,
          status: 'FAILED',
        },
        warning: 'Invoice uploaded but OCR processing failed. You can enter details manually.',
      });
    }
  } catch (error) {
    console.error('Error uploading receipt:', error);
    return NextResponse.json(
      { error: 'Failed to upload receipt' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve a receipt image
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const receiptId = request.nextUrl.searchParams.get('id');
  if (!receiptId) {
    return NextResponse.json({ error: 'Receipt ID required' }, { status: 400 });
  }

  const receipt = await db.receipt.findFirst({
    where: {
      id: receiptId,
      userId: session.user.id,
    },
  });

  if (!receipt) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  return NextResponse.json({ receipt });
}
