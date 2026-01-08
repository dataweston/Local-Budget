import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseInboundEmail, extractUserIdFromEmail, isReceiptAttachment } from '@/lib/email/parser';

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
      try {
        // Generate unique file path
        const timestamp = Date.now();
        const sanitizedFilename = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filePath = `receipts/${userId}/${timestamp}-${sanitizedFilename}`;

        // Create receipt record
        const receipt = await db.receipt.create({
          data: {
            userId,
            status: 'PENDING',
            fileName: attachment.filename,
            fileType: attachment.contentType,
            filePath,
            fileSize: attachment.size,
            source: 'email',
            sourceId: email.from,
          },
        });

        // TODO: Save file to storage (S3, local filesystem, etc.)
        // For now, we'll store the base64 content in metadata
        await db.receipt.update({
          where: { id: receipt.id },
          data: {
            extractedData: {
              base64Content: attachment.content,
            },
          },
        });

        // Queue OCR processing - this would be handled by a background job
        // For now, we'll just mark it as pending
        receipts.push(receipt);
      } catch (error) {
        console.error('Failed to process attachment:', attachment.filename, error);
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
