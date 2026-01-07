import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { processReceiptImage } from '@/lib/ocr';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF' },
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

    // Create unique filename
    const timestamp = Date.now();
    const extension = file.name.split('.').pop() || 'jpg';
    const filename = `${session.user.id}_${timestamp}.${extension}`;

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'receipts');
    await mkdir(uploadDir, { recursive: true });

    // Save file
    const filePath = path.join(uploadDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Create receipt record with PROCESSING status
    const receipt = await db.receipt.create({
      data: {
        userId: session.user.id,
        fileName: file.name,
        fileType: file.type,
        filePath: `/receipts/${filename}`,
        fileSize: file.size,
        status: 'PROCESSING',
      },
    });

    // Process OCR in background (for now, do it synchronously)
    // In production, you'd use a job queue like Bull or similar
    try {
      const ocrResult = await processReceiptImage(buffer);

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
            items: ocrResult.items,
            paymentMethod: ocrResult.paymentMethod,
            lastFourDigits: ocrResult.lastFourDigits,
          },
        },
      });

      // Fetch updated receipt
      const updatedReceipt = await db.receipt.findUnique({
        where: { id: receipt.id },
      });

      return NextResponse.json({
        success: true,
        receipt: updatedReceipt,
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
        warning: 'Receipt uploaded but OCR processing failed. You can enter details manually.',
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
