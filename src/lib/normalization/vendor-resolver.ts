/**
 * Vendor resolution: turn a raw transaction merchant name into a stable,
 * canonical Vendor row (materialized in the `vendors` table) and return its id.
 *
 * This is the keystone for the brain's vendor graph: instead of every consumer
 * re-deriving a vendor from `merchantName` with fuzzy matching, Local Budget
 * resolves once and exposes a stable `vendorId`. The raw name is accumulated
 * into the Vendor's `aliases[]` so the brain can map any bank descriptor variant
 * ("Debit Card COSTCO WHSE #0652") to the same vendor id.
 */
import type { PrismaClient } from '@prisma/client';
import { normalizeVendorName, similarity } from './vendors';

// Bank descriptors truncate names ("Eastside Food Cooperati" vs "...Cooperative")
// so normalization alone can't merge them. When there's no exact canonical hit,
// we fuzzy-match against existing vendors: a prefix relationship (one is the
// truncation of the other) or high bigram similarity collapses them onto one id.
const FUZZY_SIMILARITY_THRESHOLD = 0.82;
const MIN_PREFIX_LEN = 6;

function isTruncationMatch(a: string, b: string): boolean {
  if (a.length < MIN_PREFIX_LEN || b.length < MIN_PREFIX_LEN) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // The shorter is a leading substring of the longer (classic field truncation).
  return longer.startsWith(shorter);
}

function findFuzzyMatch(
  key: string,
  candidates: { id: string; normalizedName: string }[]
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const cKey = c.normalizedName;
    if (!cKey) continue;
    const score = isTruncationMatch(key, cKey) ? 1 : similarity(key, cKey);
    if (score >= FUZZY_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { id: c.id, score };
    }
  }
  return best?.id ?? null;
}

// A lowercase key used for dedupe within the vendors table. normalizeVendorName
// already collapses store numbers / suffixes and applies the alias map, so its
// lowercased output is a good canonical key.
export function vendorCanonicalKey(rawName: string): string {
  return normalizeVendorName(rawName).toLowerCase().trim();
}

type DbLike = Pick<PrismaClient, 'vendor'>;

// Per-batch resolution state: a canonical-key→id memo plus a roster of known
// vendors to fuzzy-match against without re-querying the table each time.
export type VendorResolverCache = {
  byKey: Map<string, string>;
  roster: { id: string; normalizedName: string }[];
};

export function createVendorResolverCache(): VendorResolverCache {
  return { byKey: new Map(), roster: [] };
}

async function loadRosterIfEmpty(db: DbLike, cache: VendorResolverCache) {
  if (cache.roster.length > 0 || cache.byKey.size > 0) return;
  const all = await db.vendor.findMany({ select: { id: true, normalizedName: true } });
  cache.roster = all;
  for (const v of all) cache.byKey.set(v.normalizedName, v.id);
}

/**
 * Resolve a raw merchant name to a Vendor id, creating the Vendor if needed and
 * recording the raw name as an alias. Returns null for empty input.
 *
 * Pass a shared `cache` (createVendorResolverCache) across a batch to memoize by
 * canonical key and enable in-memory fuzzy matching of bank-truncated names.
 */
export async function resolveVendorId(
  db: DbLike,
  rawName: string | null | undefined,
  cache?: VendorResolverCache
): Promise<string | null> {
  if (!rawName) return null;
  const canonical = normalizeVendorName(rawName);
  if (!canonical) return null;
  const key = canonical.toLowerCase().trim();

  if (cache) await loadRosterIfEmpty(db, cache);

  const cached = cache?.byKey.get(key);
  if (cached) return recordAlias(db, cached, rawName);

  // Exact match by canonical name / key / existing alias.
  const existing = await db.vendor.findFirst({
    where: {
      OR: [{ name: canonical }, { normalizedName: key }, { aliases: { has: rawName } }],
    },
    select: { id: true, aliases: true },
  });
  if (existing) {
    cache?.byKey.set(key, existing.id);
    if (rawName !== canonical && !existing.aliases.includes(rawName)) {
      await db.vendor.update({
        where: { id: existing.id },
        data: { aliases: { push: rawName } },
      });
    }
    return existing.id;
  }

  // Fuzzy match: catch bank truncation ("...Cooperati" vs "...Cooperative") and
  // near-duplicate descriptors. Record the raw name as an alias on the match.
  if (cache) {
    const fuzzyId = findFuzzyMatch(key, cache.roster);
    if (fuzzyId) {
      cache.byKey.set(key, fuzzyId);
      return recordAlias(db, fuzzyId, rawName);
    }
  }

  // Create. Unique `name` guards a race; on conflict re-read.
  try {
    const created = await db.vendor.create({
      data: {
        name: canonical,
        normalizedName: key,
        aliases: rawName !== canonical ? [rawName] : [],
      },
      select: { id: true },
    });
    cache?.byKey.set(key, created.id);
    cache?.roster.push({ id: created.id, normalizedName: key });
    return created.id;
  } catch {
    const retry = await db.vendor.findFirst({
      where: { OR: [{ name: canonical }, { normalizedName: key }] },
      select: { id: true },
    });
    if (retry) {
      cache?.byKey.set(key, retry.id);
      return retry.id;
    }
    return null;
  }
}

// Ensure the raw descriptor is captured as an alias on the resolved vendor so
// the brain can map every bank-truncation variant back to one id. Records when
// the raw name differs from both the vendor's canonical name and its existing
// aliases — covering the case where the truncated descriptor *is* its own
// canonical form but belongs to a differently-named vendor.
async function recordAlias(
  db: DbLike,
  vendorId: string,
  rawName: string
): Promise<string> {
  const v = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { name: true, aliases: true },
  });
  if (v && v.name !== rawName && !v.aliases.includes(rawName)) {
    await db.vendor.update({ where: { id: vendorId }, data: { aliases: { push: rawName } } });
  }
  return vendorId;
}
