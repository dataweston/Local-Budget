import Tesseract from 'tesseract.js';

// ============================================================================
// OCR Text Extraction
// ============================================================================

export interface OcrResult {
  text: string;
  confidence: number;
}

// Extract text from an image buffer or file path
export async function extractText(imageSource: Buffer | string): Promise<OcrResult> {
  const result = await Tesseract.recognize(imageSource, 'eng', {
    logger: (m) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`OCR Progress: ${m.status} ${Math.round((m.progress || 0) * 100)}%`);
      }
    },
  });

  return {
    text: result.data.text,
    confidence: result.data.confidence,
  };
}

// ============================================================================
// Receipt Data Parsing
// ============================================================================

export interface ParsedReceiptData {
  vendorName?: string;
  totalAmount?: number;
  subtotal?: number;
  tax?: number;
  tip?: number;
  date?: Date;
  items?: Array<{
    name: string;
    quantity?: number;
    price?: number;
  }>;
  paymentMethod?: string;
  lastFourDigits?: string;
}

// Parse extracted text to find receipt data
export function parseReceiptText(text: string): ParsedReceiptData {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const result: ParsedReceiptData = {};

  // Try to extract vendor name (usually first non-empty line or contains common keywords)
  const vendorLine = lines.find(line => 
    line.length > 3 && 
    !line.match(/^\d/) && 
    !line.toLowerCase().includes('receipt') &&
    !line.toLowerCase().includes('thank')
  );
  if (vendorLine) {
    result.vendorName = vendorLine;
  }

  // Extract total amount - look for patterns like "Total: $XX.XX" or "TOTAL $XX.XX"
  const totalPatterns = [
    /(?:grand\s*)?total[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /(?:amount\s*due|balance\s*due)[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /\$\s*(\d+[.,]\d{2})\s*(?:total|due)/i,
  ];

  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.totalAmount = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }

  // Extract subtotal
  const subtotalMatch = text.match(/subtotal[:\s]*\$?\s*(\d+[.,]\d{2})/i);
  if (subtotalMatch) {
    result.subtotal = parseFloat(subtotalMatch[1].replace(',', '.'));
  }

  // Extract tax
  const taxPatterns = [
    /(?:sales\s*)?tax[:\s]*\$?\s*(\d+[.,]\d{2})/i,
    /(?:vat|hst|gst)[:\s]*\$?\s*(\d+[.,]\d{2})/i,
  ];
  for (const pattern of taxPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.tax = parseFloat(match[1].replace(',', '.'));
      break;
    }
  }

  // Extract tip
  const tipMatch = text.match(/(?:tip|gratuity)[:\s]*\$?\s*(\d+[.,]\d{2})/i);
  if (tipMatch) {
    result.tip = parseFloat(tipMatch[1].replace(',', '.'));
  }

  // Extract date - common formats
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,  // MM/DD/YYYY or DD-MM-YYYY
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,    // YYYY-MM-DD
    /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/,  // Month DD, YYYY
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const dateStr = match[0];
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          result.date = parsed;
          break;
        }
      } catch {
        // Continue to next pattern
      }
    }
  }

  // Extract payment method
  const paymentMethods = ['visa', 'mastercard', 'amex', 'discover', 'debit', 'credit', 'cash', 'check'];
  for (const method of paymentMethods) {
    if (text.toLowerCase().includes(method)) {
      result.paymentMethod = method.charAt(0).toUpperCase() + method.slice(1);
      break;
    }
  }

  // Extract last 4 digits of card
  const cardMatch = text.match(/[*xX]{4,}\s*(\d{4})/);
  if (cardMatch) {
    result.lastFourDigits = cardMatch[1];
  }

  // Try to extract line items (basic implementation)
  const items: ParsedReceiptData['items'] = [];
  const itemPattern = /^(.+?)\s+\$?\s*(\d+[.,]\d{2})$/;
  
  for (const line of lines) {
    const match = line.match(itemPattern);
    if (match && !line.toLowerCase().includes('total') && !line.toLowerCase().includes('subtotal')) {
      items.push({
        name: match[1].trim(),
        price: parseFloat(match[2].replace(',', '.')),
      });
    }
  }
  
  if (items.length > 0) {
    result.items = items;
  }

  return result;
}

// ============================================================================
// Full Processing Pipeline
// ============================================================================

export interface ProcessedReceipt extends ParsedReceiptData {
  rawText: string;
  confidence: number;
}

export async function processReceiptImage(imageSource: Buffer | string): Promise<ProcessedReceipt> {
  // Step 1: Extract text with OCR
  const ocrResult = await extractText(imageSource);
  
  // Step 2: Parse the extracted text
  const parsedData = parseReceiptText(ocrResult.text);
  
  return {
    ...parsedData,
    rawText: ocrResult.text,
    confidence: ocrResult.confidence,
  };
}
