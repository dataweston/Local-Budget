import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { processReceiptDocument } from '@/lib/ocr';
import { storeReceiptFile } from '@/lib/receipt-storage';

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
        filePath: stored.publicPath,
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

    // Process OCR in background (for now, do it synchronously)
    // In production, you'd use a job queue like Bull or similar
    try {
      const ocrResult = await processReceiptDocument({
        buffer: stored.ocrBuffer,
        mimeType: file.type,
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
            receiptId: receipt.id,
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

      // Update receipt with OCR results
      await db.receipt.update({
        where: { id: receipt.id },
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
            storage: stored.storageMeta,
            items: ocrResult.items,
            paymentMethod: ocrResult.paymentMethod,
            lastFourDigits: ocrResult.lastFourDigits,
          },
        },
      });

      if (lineItems.length > 0) {
        await db.lineItem.createMany({
          data: lineItems,
        });
      }

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
      console.error('OCR processing failed:', ocrError);

      // Update status to FAILED
      await db.receipt.update({
        where: { id: receipt.id },
        data: {
          status: 'FAILED',
          notes: `OCR failed: ${ocrError instanceof Error ? ocrError.message : 'Unknown error'}`,
        },
      });

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
