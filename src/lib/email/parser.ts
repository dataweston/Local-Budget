/**
 * Email receipt ingestion utilities
 * Handles parsing of inbound email webhooks from SendGrid/Mailgun
 */

interface EmailAttachment {
  filename: string;
  contentType: string;
  content: string; // Base64 encoded
  size: number;
}

interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  body?: string;
  attachments: EmailAttachment[];
  receivedAt: Date;
}

/**
 * Parse inbound email payload from webhook
 * Compatible with SendGrid and Mailgun webhook formats
 */
export function parseInboundEmail(payload: any): ParsedEmail {
  // SendGrid format
  if (payload.from && payload.attachments) {
    return {
      from: payload.from,
      to: payload.to || '',
      subject: payload.subject || '',
      body: payload.text || payload.html,
      attachments: parseAttachmentsSendGrid(payload.attachments),
      receivedAt: new Date(),
    };
  }

  // Mailgun format
  if (payload.sender && payload['body-plain']) {
    return {
      from: payload.sender,
      to: payload.recipient || '',
      subject: payload.subject || '',
      body: payload['body-plain'] || payload['body-html'],
      attachments: parseAttachmentsMailgun(payload),
      receivedAt: new Date(payload.timestamp * 1000),
    };
  }

  throw new Error('Unsupported email format');
}

/**
 * Extract user ID from receipt email address
 * Format: receipts+{userId}@domain.com
 */
export function extractUserIdFromEmail(email: string): string | null {
  const match = email.match(/receipts\+([a-zA-Z0-9]+)@/);
  return match ? match[1] : null;
}

/**
 * Check if attachment is a valid receipt (image or PDF)
 */
export function isReceiptAttachment(attachment: EmailAttachment): boolean {
  const validTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
  ];

  return validTypes.includes(attachment.contentType.toLowerCase());
}

/**
 * Parse SendGrid attachments
 */
function parseAttachmentsSendGrid(attachments: any): EmailAttachment[] {
  if (!attachments || typeof attachments !== 'object') {
    return [];
  }

  // SendGrid can send attachments as object or string
  const attachmentObj = typeof attachments === 'string' 
    ? JSON.parse(attachments) 
    : attachments;

  return Object.keys(attachmentObj).map((key) => {
    const att = attachmentObj[key];
    return {
      filename: att.filename || key,
      contentType: att.type || att.contentType || 'application/octet-stream',
      content: att.content || '',
      size: att.content ? Buffer.from(att.content, 'base64').length : 0,
    };
  });
}

/**
 * Parse Mailgun attachments
 */
function parseAttachmentsMailgun(payload: any): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];
  
  // Mailgun sends attachments as attachment-1, attachment-2, etc.
  let i = 1;
  while (payload[`attachment-${i}`]) {
    const att = payload[`attachment-${i}`];
    attachments.push({
      filename: att.filename || `attachment-${i}`,
      contentType: att.contentType || 'application/octet-stream',
      content: att.content ? att.content.toString('base64') : '',
      size: att.size || 0,
    });
    i++;
  }

  return attachments;
}

/**
 * Generate unique receipt email for user
 */
export function generateReceiptEmail(userId: string, domain: string = 'localhost'): string {
  return `receipts+${userId}@${domain}`;
}
