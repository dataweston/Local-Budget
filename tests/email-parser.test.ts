import { describe, it, expect } from 'vitest';
import { extractUserIdFromEmail, isReceiptAttachment, parseInboundEmail } from '@/lib/email/parser';

describe('extractUserIdFromEmail', () => {
  it('extracts the user id from receipts+<id>@ addresses', () => {
    expect(extractUserIdFromEmail('receipts+clw9x2ab3000008l9@app.test')).toBe(
      'clw9x2ab3000008l9'
    );
  });

  it('returns null for non-matching addresses', () => {
    expect(extractUserIdFromEmail('someone@app.test')).toBeNull();
    expect(extractUserIdFromEmail('receipts@app.test')).toBeNull();
  });
});

describe('isReceiptAttachment', () => {
  it('accepts images and PDFs', () => {
    expect(
      isReceiptAttachment({ filename: 'r.jpg', contentType: 'image/jpeg', content: '', size: 1 })
    ).toBe(true);
    expect(
      isReceiptAttachment({ filename: 'r.pdf', contentType: 'application/pdf', content: '', size: 1 })
    ).toBe(true);
  });

  it('rejects other types', () => {
    expect(
      isReceiptAttachment({ filename: 'r.zip', contentType: 'application/zip', content: '', size: 1 })
    ).toBe(false);
  });
});

describe('parseInboundEmail', () => {
  it('parses the Mailgun shape', () => {
    const parsed = parseInboundEmail({
      sender: 'vendor@x.test',
      recipient: 'receipts+abc@app.test',
      subject: 'Invoice',
      'body-plain': 'hello',
      timestamp: 1760000000,
    });
    expect(parsed.from).toBe('vendor@x.test');
    expect(parsed.to).toBe('receipts+abc@app.test');
  });

  it('throws on unknown shapes', () => {
    expect(() => parseInboundEmail({ foo: 'bar' })).toThrow();
  });
});
