import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseInboundEmail, extractUserIdFromEmail, isReceiptAttachment } from '@/lib/email/parser';
import { storeReceiptFile } from '@/lib/receipt-storage';
import { enqueueReceiptOcrJob } from '@/lib/receipt-processing';
import { authorizeServiceRequest } from '@/lib/service-auth';

/**
 * Webhook endpoint for inbound receipt emails (SendGrid/Mailgun).
 *
 * Authentication: the provider must present INBOUND_EMAIL_WEBHOOK_SECRET as a
 * bearer token, x-webhook-token header, or ?token= query parameter (set it in
 * the webhook URL you configure at the provider). Requests are rejected when
 * the secret is unset — this endpoint creates financial records.
 *
 * OCR runs asynchronously via the background-job worker so the provider gets
 * a fast 200 and webhook delivery never times out on Tesseract.
 */
export async function POST(req: NextRequest) {
  const auth = authorizeServiceRequest(
    req,
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET,
    'INBOUND_EMAIL_WEBHOOK_SECRET'
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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

    // Store each attachment and queue OCR
    const receipts = [];
    for (const attachment of receiptAttachments) {
      try {
        const contentBuffer = Buffer.from(attachment.content, 'base64');
        const stored = await storeReceiptFile({
          userId,
          originalName: attachment.filename,
          mimeType: attachment.contentType,
          buffer: contentBuffer,
          source: 'email',
        });

        const receipt = await db.receipt.create({
          data: {
            userId,
            status: 'PENDING',
            fileName: attachment.filename,
            fileType: stored.fileType,
            filePath: stored.filePath,
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

        await enqueueReceiptOcrJob(receipt.id);
        receipts.push(receipt);
      } catch (error) {
        console.error('Failed to store attachment:', attachment.filename, error);
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
