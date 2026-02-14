import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseInboundEmail, extractUserIdFromEmail, isReceiptAttachment } from '@/lib/email/parser';
import { processReceiptDocument } from '@/lib/ocr';
import { storeReceiptFile } from '@/lib/receipt-storage';

/**
 * Webhook endpoint for inbound receipt emails
 * Accepts POST requests from SendGrid or Mailgun
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let payload: any;

    // Parse based on content type
    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else if (contentType.includes('multipart/form-data')) {
      // For Mailgun multipart
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      return NextResponse.json(
        { error: 'Unsupported content type' },
        { status: 400 }
      );
    }

    // Parse the email
    const email = parseInboundEmail(payload);

    // Extract user ID from recipient email
    const userId = extractUserIdFromEmail(email.to);
    if (!userId) {
      return NextResponse.json(
        { error: 'Invalid recipient email format' },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Filter valid receipt attachments
    const receiptAttachments = email.attachments.filter(isReceiptAttachment);

    if (receiptAttachments.length === 0) {
      return NextResponse.json(
        { error: 'No valid receipt attachments found' },
        { status: 400 }
      );
    }

    // Process each attachment
    const receipts = [];
    for (const attachment of receiptAttachments) {
      let createdReceiptId: string | null = null;
      try {
        const contentBuffer = Buffer.from(attachment.content, 'base64');
        const stored = await storeReceiptFile({
          userId,
          originalName: attachment.filename,
          mimeType: attachment.contentType,
          buffer: contentBuffer,
          source: 'email',
        });

        // Create receipt record
        const receipt = await db.receipt.create({
          data: {
            userId,
            status: 'PROCESSING',
            fileName: attachment.filename,
            fileType: stored.fileType,
            filePath: stored.publicPath,
            fileSize: stored.fileSize,
            source: 'email',
            sourceId: email.from,
            extractedData: {
              storage: stored.storageMeta,
              email: {
                from: email.from,
                subject: email.subject,
                receivedAt: email.receivedAt.toISOString(),
              },
            },
          },
        });
        createdReceiptId = receipt.id;

        const ocrResult = await processReceiptDocument({
          buffer: stored.ocrBuffer,
          mimeType: attachment.contentType,
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
              email: {
                from: email.from,
                subject: email.subject,
                receivedAt: email.receivedAt.toISOString(),
              },
              items: ocrResult.items,
              paymentMethod: ocrResult.paymentMethod,
              lastFourDigits: ocrResult.lastFourDigits,
            },
          },
        });

        if (lineItems.length > 0) {
          await db.lineItem.createMany({ data: lineItems });
        }

        receipts.push(receipt);
      } catch (error) {
        console.error('Failed to process attachment:', attachment.filename, error);
        if (createdReceiptId) {
          await db.receipt.update({
            where: { id: createdReceiptId },
            data: {
              status: 'FAILED',
              notes: `OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          });
        }
        // Continue with other attachments
      }
    }

    return NextResponse.json({
      success: true,
      receiptsCreated: receipts.length,
      receipts: receipts.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        status: r.status,
      })),
    });
  } catch (error) {
    console.error('Email webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process email' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'email-inbound-webhook',
  });
}
