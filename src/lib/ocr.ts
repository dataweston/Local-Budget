import Tesseract from 'tesseract.js';

const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;

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
    unitOfMeasure?: string;
    unitPrice?: number;
    price?: number;
    kind?: 'item' | 'shipping' | 'fee' | 'tax' | 'tip' | 'discount' | 'other';
    classificationHint?: 'COGS' | 'OPERATING' | 'PERSONAL';
  }>;
  paymentMethod?: string;
  lastFourDigits?: string;
}

function parseAmountToken(input: string): number | null {
  const match = input.match(/-?\$?\s*(\d+[.,]\d{2})/);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(',', '.'));
}

// Units of measure that matter for recipe/ingredient costing. Matched as whole
// tokens so "lb"/"oz"/"kg"/"each"/"case" etc. are pulled off an item line. The
// brain's food-cost subsystem needs quantity + unit + price per ingredient.
const UNIT_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(lbs?|pounds?|oz|ounces?|kgs?|g|grams?|ml|l|liters?|gal|gallons?|qt|quarts?|pt|pints?|ea|each|cases?|cs|dz|dozen|ct|count|pk|packs?|bx|box|bags?|btls?|bottles?)\b/i;

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().replace(/s$/, '');
  const map: Record<string, string> = {
    lb: 'lb', pound: 'lb',
    oz: 'oz', ounce: 'oz',
    kg: 'kg', g: 'g', gram: 'g',
    ml: 'ml', l: 'L', liter: 'L',
    gal: 'gal', gallon: 'gal',
    qt: 'qt', quart: 'qt', pt: 'pt', pint: 'pt',
    ea: 'each', each: 'each',
    case: 'case', cs: 'case',
    dz: 'dozen', dozen: 'dozen',
    ct: 'count', count: 'count',
    pk: 'pack', pack: 'pack',
    bx: 'box', box: 'box', bag: 'bag',
    btl: 'bottle', bottle: 'bottle',
  };
  return map[u] ?? u;
}

// Pull a quantity + unit-of-measure out of an item name, if present.
function extractUnit(name: string): { quantity?: number; unitOfMeasure?: string } {
  const m = name.match(UNIT_PATTERN);
  if (!m) return {};
  return { quantity: Number.parseFloat(m[1]), unitOfMeasure: normalizeUnit(m[2]) };
}

function inferItemKind(name: string): NonNullable<NonNullable<ParsedReceiptData['items']>[number]['kind']> {
  const normalized = name.toLowerCase();
  if (/\b(ship|shipping|delivery|freight)\b/.test(normalized)) return 'shipping';
  if (/\b(fee|service charge|convenience|processing|surcharge)\b/.test(normalized)) return 'fee';
  if (/\b(tax|vat|gst|hst)\b/.test(normalized)) return 'tax';
  if (/\b(tip|gratuity)\b/.test(normalized)) return 'tip';
  if (/\b(discount|coupon|promo|savings?)\b/.test(normalized)) return 'discount';
  return 'item';
}

function classificationHintForKind(
  kind: NonNullable<NonNullable<ParsedReceiptData['items']>[number]['kind']>
): 'COGS' | 'OPERATING' | 'PERSONAL' {
  if (kind === 'item') return 'COGS';
  if (kind === 'discount') return 'COGS';
  return 'OPERATING';
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

  // Extract line items and invoice charges.
  const items: ParsedReceiptData['items'] = [];
  const itemPattern = /^(.+?)\s+(-?\$?\s*\d+[.,]\d{2})$/i;
  const qtyPattern = /^(\d+(?:\.\d+)?)\s*[xX]\s*(.+?)\s+(-?\$?\s*\d+[.,]\d{2})$/i;
  const invoiceNoisePattern =
    /\b(total|subtotal|amount due|balance due|cash|change|card|visa|mastercard|debit|credit)\b/i;
  
  for (const line of lines) {
    if (invoiceNoisePattern.test(line)) continue;

    const qtyMatch = line.match(qtyPattern);
    if (qtyMatch) {
      const qty = Number.parseFloat(qtyMatch[1]);
      const name = qtyMatch[2].trim();
      const price = parseAmountToken(qtyMatch[3]);
      if (!Number.isNaN(qty) && price !== null) {
        const kind = inferItemKind(name);
        const unit = extractUnit(name);
        items.push({
          name,
          quantity: qty,
          unitOfMeasure: unit.unitOfMeasure,
          unitPrice: qty > 0 ? Number((price / qty).toFixed(4)) : undefined,
          price,
          kind,
          classificationHint: classificationHintForKind(kind),
        });
        continue;
      }
    }

    const match = line.match(itemPattern);
    if (match) {
      const name = match[1].trim();
      const price = parseAmountToken(match[2]);
      if (price === null) continue;
      const kind = inferItemKind(name);
      const unit = extractUnit(name);
      items.push({
        name,
        quantity: unit.quantity,
        unitOfMeasure: unit.unitOfMeasure,
        unitPrice:
          unit.quantity && unit.quantity > 0
            ? Number((price / unit.quantity).toFixed(4))
            : undefined,
        price,
        kind,
        classificationHint: classificationHintForKind(kind),
      });
    }
  }
  
  // Backfill tax/tip as explicit searchable line items if OCR didn't catch them in item rows.
  if (result.tax && !items.some((i) => i.kind === 'tax')) {
    items.push({
      name: 'Sales Tax',
      price: result.tax,
      kind: 'tax',
      classificationHint: 'OPERATING',
    });
  }
  if (result.tip && !items.some((i) => i.kind === 'tip')) {
    items.push({
      name: 'Tip',
      price: result.tip,
      kind: 'tip',
      classificationHint: 'OPERATING',
    });
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

export async function processReceiptDocument(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<ProcessedReceipt> {
  if (input.mimeType.toLowerCase() === 'application/pdf') {
    const pdf = await pdfParse(input.buffer);
    const parsedData = parseReceiptText(pdf.text || '');
    return {
      ...parsedData,
      rawText: pdf.text || '',
      confidence: 100,
    };
  }

  return processReceiptImage(input.buffer);
}
