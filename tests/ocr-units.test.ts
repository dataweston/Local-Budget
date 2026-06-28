import { describe, it, expect } from 'vitest';
import { parseReceiptText } from '@/lib/ocr';

describe('parseReceiptText unit extraction', () => {
  it('extracts quantity, unit of measure, and derived unit price', () => {
    const text = ['Eastside Food Cooperative', 'Carrots 25 lb $50.00', 'Total $50.00'].join('\n');
    const parsed = parseReceiptText(text);
    const carrots = parsed.items?.find((i) => /carrot/i.test(i.name));
    expect(carrots).toBeTruthy();
    expect(carrots?.quantity).toBe(25);
    expect(carrots?.unitOfMeasure).toBe('lb');
    expect(carrots?.unitPrice).toBe(2);
  });

  it('handles a quantity-prefixed line (3 x Onions)', () => {
    const text = ['Vendor', '3 x Onions $9.00'].join('\n');
    const parsed = parseReceiptText(text);
    const onions = parsed.items?.find((i) => /onion/i.test(i.name));
    expect(onions?.quantity).toBe(3);
    expect(onions?.unitPrice).toBe(3);
  });

  it('normalizes unit aliases (pounds -> lb, gallon -> gal)', () => {
    const parsed = parseReceiptText(['V', 'Flour 10 pounds $8.00', 'Milk 2 gallons $7.00'].join('\n'));
    const flour = parsed.items?.find((i) => /flour/i.test(i.name));
    const milk = parsed.items?.find((i) => /milk/i.test(i.name));
    expect(flour?.unitOfMeasure).toBe('lb');
    expect(milk?.unitOfMeasure).toBe('gal');
  });

  it('classifies fee/tax lines as non-item kinds', () => {
    const parsed = parseReceiptText(['V', 'Delivery Fee $5.00', 'Sales Tax $3.00'].join('\n'));
    const fee = parsed.items?.find((i) => /delivery/i.test(i.name));
    expect(fee?.kind).toBe('shipping');
  });
});
