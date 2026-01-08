/**
 * Vendor name normalization utilities
 * Handles canonical naming and duplicate detection
 */

/**
 * Known vendor aliases - maps canonical names to common variations
 */
export const VENDOR_ALIASES: Record<string, string[]> = {
  'Amazon': [
    'amazon.com',
    'amzn mktp',
    'amzn digital',
    'amazon marketplace',
    'amazon prime',
    'aws',
  ],
  'Walmart': [
    'wal-mart',
    'walmart.com',
    'walmart supercenter',
    'walmart neighborhood',
  ],
  'Target': [
    'target.com',
    'target store',
  ],
  'Starbucks': [
    'starbucks coffee',
    'sbux',
  ],
  'McDonalds': [
    "mcdonald's",
    'mcdonalds restaurant',
  ],
  'Shell': [
    'shell oil',
    'shell gas',
  ],
  'Chevron': [
    'chevron gas',
    'chevron station',
  ],
  'CVS': [
    'cvs pharmacy',
    'cvs/pharmacy',
  ],
  'Walgreens': [
    'walgreens pharmacy',
  ],
  'Home Depot': [
    'the home depot',
    'homedepot.com',
  ],
  "Lowe's": [
    'lowes',
    'lowes home improvement',
  ],
  'Costco': [
    'costco wholesale',
    'costco warehouse',
  ],
  'Uber': [
    'uber trip',
    'uber eats',
  ],
  'Lyft': [
    'lyft ride',
  ],
  'Netflix': [
    'netflix.com',
  ],
  'Spotify': [
    'spotify usa',
  ],
  'Apple': [
    'apple.com/bill',
    'apple store',
    'itunes',
    'app store',
  ],
  'Google': [
    'google storage',
    'google*',
    'google play',
  ],
};

/**
 * Normalize a vendor name to its canonical form
 */
export function normalizeVendorName(rawName: string): string {
  if (!rawName) return '';

  // Remove common prefixes/suffixes
  let normalized = rawName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    // Remove common patterns
    .replace(/\s*#\d+/g, '') // Remove store numbers
    .replace(/\s*-\s*\d+/g, '') // Remove location numbers
    .replace(/\s+store$/i, '')
    .replace(/\s+inc\.?$/i, '')
    .replace(/\s+llc\.?$/i, '')
    .replace(/\s+ltd\.?$/i, '')
    .replace(/\s+corp\.?$/i, '')
    .replace(/\s+co\.?$/i, '')
    .trim();

  // Check against known aliases
  for (const [canonical, aliases] of Object.entries(VENDOR_ALIASES)) {
    const canonicalLower = canonical.toLowerCase();
    
    // Check if normalized name matches canonical
    if (normalized === canonicalLower) {
      return canonical;
    }

    // Check if normalized name matches any alias
    for (const alias of aliases) {
      if (normalized.includes(alias.toLowerCase())) {
        return canonical;
      }
    }
  }

  // Return cleaned name with proper capitalization
  return rawName
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find similar vendors that might be duplicates
 */
export function findSimilarVendors(
  vendors: Array<{ name: string; count?: number }>,
  threshold: number = 0.8
): Array<{ group: string[]; similarity: number }> {
  const duplicateGroups: Array<{ group: string[]; similarity: number }> = [];
  const processed = new Set<string>();

  for (let i = 0; i < vendors.length; i++) {
    if (processed.has(vendors[i].name)) continue;

    const similar: string[] = [vendors[i].name];

    for (let j = i + 1; j < vendors.length; j++) {
      if (processed.has(vendors[j].name)) continue;

      const sim = similarity(vendors[i].name, vendors[j].name);
      if (sim >= threshold) {
        similar.push(vendors[j].name);
        processed.add(vendors[j].name);
      }
    }

    if (similar.length > 1) {
      processed.add(vendors[i].name);
      duplicateGroups.push({
        group: similar,
        similarity: threshold,
      });
    }
  }

  return duplicateGroups;
}

/**
 * Calculate similarity between two strings using Jaccard similarity on character bigrams
 */
export function similarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  // Generate bigrams
  const bigrams1 = getBigrams(s1);
  const bigrams2 = getBigrams(s2);

  // Calculate Jaccard similarity
  const bigrams1Array = Array.from(bigrams1);
  const bigrams2Array = Array.from(bigrams2);
  
  const intersection = bigrams1Array.filter((x) => bigrams2.has(x));
  const union = Array.from(new Set([...bigrams1Array, ...bigrams2Array]));

  return intersection.length / union.length;
}

/**
 * Get character bigrams from a string
 */
function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Extract vendor name from common transaction description patterns
 */
export function extractVendorFromDescription(description: string): string {
  // Remove common prefixes
  let vendor = description
    .replace(/^(pos|debit card|purchase|payment|online payment)\s*/i, '')
    .replace(/\d{4,}$/, '') // Remove trailing numbers (reference IDs)
    .trim();

  // Take first part before common delimiters
  const parts = vendor.split(/[\s-]+/);
  if (parts.length > 0) {
    vendor = parts[0];
  }

  return normalizeVendorName(vendor);
}
