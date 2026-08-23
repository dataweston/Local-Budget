import { describe, expect, it } from 'vitest';
import { receiptContentHash } from '@/lib/receipt-storage';

describe('receipt evidence identity', () => {
  it('uses content identity rather than filename or upload time', () => {
    const first = receiptContentHash(Buffer.from('same original evidence'));
    const second = receiptContentHash(Buffer.from('same original evidence'));
    const changed = receiptContentHash(Buffer.from('changed evidence'));
    expect(first).toBe(second);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
