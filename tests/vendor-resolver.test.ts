import { describe, it, expect } from 'vitest';
import {
  resolveVendorId,
  createVendorResolverCache,
} from '@/lib/normalization/vendor-resolver';

// Minimal in-memory stand-in for Prisma's `vendor` delegate, enough to exercise
// resolver logic (find/create/update by name, normalizedName, aliases).
function makeFakeDb() {
  const rows: any[] = [];
  let seq = 0;
  const matchWhere = (row: any, where: any): boolean => {
    if (where.OR) return where.OR.some((c: any) => matchWhere(row, c));
    if (where.name !== undefined) return row.name === where.name;
    if (where.normalizedName !== undefined) return row.normalizedName === where.normalizedName;
    if (where.aliases?.has !== undefined) return row.aliases.includes(where.aliases.has);
    if (where.id !== undefined) return row.id === where.id;
    return false;
  };
  return {
    rows,
    vendor: {
      findMany: async ({ select }: any = {}) =>
        rows.map((r) => ({ id: r.id, normalizedName: r.normalizedName, ...(select?.aliases ? { aliases: r.aliases } : {}) })),
      findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
      findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: any) => {
        if (rows.some((r) => r.name === data.name)) throw new Error('unique');
        const row = { id: `v${++seq}`, aliases: [], ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (data.aliases?.push) row.aliases.push(data.aliases.push);
        if (data.defaultClassification) row.defaultClassification = data.defaultClassification;
        return row;
      },
    },
  };
}

describe('resolveVendorId', () => {
  it('returns null for empty input', async () => {
    const db = makeFakeDb();
    expect(await resolveVendorId(db as any, '')).toBeNull();
    expect(await resolveVendorId(db as any, null)).toBeNull();
  });

  it('reuses the same vendor for repeated names', async () => {
    const db = makeFakeDb();
    const cache = createVendorResolverCache();
    const a = await resolveVendorId(db as any, 'Eastside Food Cooperative', cache);
    const b = await resolveVendorId(db as any, 'Eastside Food Cooperative', cache);
    expect(a).toBe(b);
    expect(db.rows).toHaveLength(1);
  });

  it('merges bank-truncated descriptors onto one vendor (Eastside case)', async () => {
    const db = makeFakeDb();
    const cache = createVendorResolverCache();
    const full = await resolveVendorId(db as any, 'Eastside Food Cooperative', cache);
    const truncated = await resolveVendorId(db as any, 'Eastside Food Cooperati', cache);
    expect(truncated).toBe(full);
    expect(db.rows).toHaveLength(1);
    // The truncated raw name is captured as an alias for brain reconciliation.
    expect(db.rows[0].aliases).toContain('Eastside Food Cooperati');
  });

  it('merges Costco descriptor variants via the alias map', async () => {
    const db = makeFakeDb();
    const cache = createVendorResolverCache();
    const a = await resolveVendorId(db as any, 'Costco', cache);
    const b = await resolveVendorId(db as any, 'COSTCO WHSE', cache);
    expect(b).toBe(a);
    expect(db.rows).toHaveLength(1);
  });

  it('keeps genuinely different vendors separate', async () => {
    const db = makeFakeDb();
    const cache = createVendorResolverCache();
    const a = await resolveVendorId(db as any, 'Eastside Food Cooperative', cache);
    const b = await resolveVendorId(db as any, 'Whole Foods Market', cache);
    expect(a).not.toBe(b);
    expect(db.rows).toHaveLength(2);
  });
});
