import { describe, expect, it } from 'vitest';
import { transferApprovalKey } from '@/lib/transfers/service';

describe('transfer proposal approval identity', () => {
  it('is directional and exact', () => {
    expect(transferApprovalKey({ outflowId: 'out-1', inflowId: 'in-1' })).toBe('out-1:in-1');
    expect(transferApprovalKey({ outflowId: 'in-1', inflowId: 'out-1' })).not.toBe(
      transferApprovalKey({ outflowId: 'out-1', inflowId: 'in-1' })
    );
  });
});
