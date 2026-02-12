import { db } from '@/lib/db';
import { normalizeVendorName } from '@/lib/normalization/vendors';

/**
 * Category suggestion engine
 * Uses historical behavior + rule matches with multi-signal scoring.
 */

interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  confidence: number;
  reason: string;
}

type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

type CategorizedReference = {
  categoryId: string;
  categoryName: string;
  type: TransactionType;
  merchantKey: string | null;
  merchantTokens: Set<string>;
  descriptionKey: string;
  descriptionTokens: Set<string>;
};

type RuleReference = {
  id: string;
  name: string;
  priority: number;
  matchField: string;
  matchType: 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'REGEX';
  matchValue: string;
  categoryId: string;
  categoryName: string;
};

type SuggestionContext = {
  references: CategorizedReference[];
  rules: RuleReference[];
};

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'card',
  'debit',
  'credit',
  'payment',
  'purchase',
  'online',
  'bank',
  'transfer',
  'ach',
  'pos',
]);

const MERCHANT_SIMILARITY_THRESHOLD = 0.56;
const DESCRIPTION_SIMILARITY_THRESHOLD = 0.55;

/**
 * Main category suggestion function
 */
export async function suggestCategory(
  userId: string,
  merchantName: string | null,
  description: string,
  type?: string
): Promise<CategorySuggestion[]> {
  const context = await buildSuggestionContext(userId);
  return suggestCategoryWithContext(context, merchantName, description, type);
}

function suggestCategoryWithContext(
  context: SuggestionContext,
  merchantName: string | null,
  description: string,
  type?: string
): CategorySuggestion[] {
  const candidateMap = new Map<
    string,
    { categoryName: string; confidence: number; reasons: Set<string> }
  >();

  const merchantCandidates = findMerchantCandidates(context, merchantName, type);
  for (const candidate of merchantCandidates) {
    addCandidate(candidateMap, candidate);
  }

  const descriptionCandidates = findDescriptionCandidates(context, description, type);
  for (const candidate of descriptionCandidates) {
    addCandidate(candidateMap, candidate);
  }

  const ruleCandidates = matchKeywordRules(context, merchantName, description);
  for (const candidate of ruleCandidates) {
    addCandidate(candidateMap, candidate);
  }

  const suggestions = Array.from(candidateMap.entries())
    .map(([categoryId, data]) => {
      let confidence = data.confidence;
      if (data.reasons.size > 1) {
        // Boost confidence when multiple independent signals agree.
        confidence = clamp(confidence + 0.05, 0, 0.99);
      }

      return {
        categoryId,
        categoryName: data.categoryName,
        confidence,
        reason: Array.from(data.reasons).slice(0, 2).join(' + '),
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  return suggestions;
}

function addCandidate(
  map: Map<string, { categoryName: string; confidence: number; reasons: Set<string> }>,
  candidate: CategorySuggestion
) {
  const existing = map.get(candidate.categoryId);
  if (!existing) {
    map.set(candidate.categoryId, {
      categoryName: candidate.categoryName,
      confidence: candidate.confidence,
      reasons: new Set([candidate.reason]),
    });
    return;
  }

  existing.confidence = Math.max(existing.confidence, candidate.confidence);
  existing.reasons.add(candidate.reason);
}

function findMerchantCandidates(
  context: SuggestionContext,
  merchantName: string | null,
  type?: string
): CategorySuggestion[] {
  const targetMerchant = normalizeMerchantKey(merchantName);
  if (!targetMerchant) return [];

  const targetTokens = tokenize(targetMerchant);
  const refs = getComparableReferences(context.references, type).filter(
    (r) => !!r.merchantKey
  );

  const scoreByCategory = new Map<
    string,
    {
      categoryName: string;
      score: number;
      count: number;
      bestSimilarity: number;
      exactHits: number;
    }
  >();

  for (const ref of refs) {
    if (!ref.merchantKey) continue;

    const simText = calculateSimilarity(targetMerchant, ref.merchantKey);
    const simTokens = tokenSimilarity(targetTokens, ref.merchantTokens);
    const similarity = Math.max(simText, simTokens);

    if (similarity < MERCHANT_SIMILARITY_THRESHOLD) continue;

    const exactMatch = ref.merchantKey === targetMerchant;
    const containedMatch =
      targetMerchant.includes(ref.merchantKey) ||
      ref.merchantKey.includes(targetMerchant);

    const weighted =
      similarity + (exactMatch ? 0.35 : 0) + (containedMatch ? 0.08 : 0);

    const current = scoreByCategory.get(ref.categoryId) ?? {
      categoryName: ref.categoryName,
      score: 0,
      count: 0,
      bestSimilarity: 0,
      exactHits: 0,
    };
    current.score += weighted;
    current.count += 1;
    current.bestSimilarity = Math.max(current.bestSimilarity, similarity);
    if (exactMatch) current.exactHits += 1;
    scoreByCategory.set(ref.categoryId, current);
  }

  return Array.from(scoreByCategory.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 3)
    .map(([categoryId, data]) => {
      const confidence = clamp(
        0.5 +
          data.bestSimilarity * 0.32 +
          Math.min(0.12, data.count * 0.02) +
          Math.min(0.1, data.exactHits * 0.05),
        0.55,
        0.97
      );

      return {
        categoryId,
        categoryName: data.categoryName,
        confidence,
        reason:
          data.exactHits > 0
            ? 'Merchant history match'
            : 'Similar merchant pattern',
      };
    });
}

function findDescriptionCandidates(
  context: SuggestionContext,
  description: string,
  type?: string
): CategorySuggestion[] {
  const descKey = normalizeDescription(description);
  const descTokens = tokenize(descKey);
  if (!descKey || descTokens.size === 0) return [];

  const refs = getComparableReferences(context.references, type);

  const scoreByCategory = new Map<
    string,
    { categoryName: string; score: number; count: number; bestSimilarity: number }
  >();

  for (const ref of refs) {
    const simText = calculateSimilarity(descKey, ref.descriptionKey);
    const simTokens = tokenSimilarity(descTokens, ref.descriptionTokens);
    const similarity = Math.max(simText * 0.85, simTokens);

    if (similarity < DESCRIPTION_SIMILARITY_THRESHOLD) continue;

    const current = scoreByCategory.get(ref.categoryId) ?? {
      categoryName: ref.categoryName,
      score: 0,
      count: 0,
      bestSimilarity: 0,
    };
    current.score += similarity;
    current.count += 1;
    current.bestSimilarity = Math.max(current.bestSimilarity, similarity);
    scoreByCategory.set(ref.categoryId, current);
  }

  return Array.from(scoreByCategory.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 2)
    .map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.categoryName,
      confidence: clamp(
        0.43 + data.bestSimilarity * 0.3 + Math.min(0.08, data.count * 0.015),
        0.5,
        0.84
      ),
      reason: 'Description pattern match',
    }));
}

function matchKeywordRules(
  context: SuggestionContext,
  merchantName: string | null,
  description: string
): CategorySuggestion[] {
  const merchantRaw = merchantName || '';
  const descriptionRaw = description;
  const merchantText = normalizeText(merchantName || '');
  const descriptionText = normalizeText(description);
  const results: CategorySuggestion[] = [];

  for (const rule of context.rules) {
    const normalizedText =
      rule.matchField === 'merchantName' ? merchantText : descriptionText;
    const rawText = rule.matchField === 'merchantName' ? merchantRaw : descriptionRaw;
    const searchText = rule.matchType === 'REGEX' ? rawText : normalizedText;
    const matched = matchRule(searchText, rule.matchType, rule.matchValue);
    if (!matched) continue;

    const confidence = clamp(
      0.68 + Math.min(0.18, rule.priority * 0.02),
      0.68,
      0.92
    );

    results.push({
      categoryId: rule.categoryId,
      categoryName: rule.categoryName,
      confidence,
      reason: `Rule: ${rule.name}`,
    });
  }

  return results;
}

function matchRule(value: string, matchType: string, pattern: string): boolean {
  const lowerValue = value.toLowerCase();
  const lowerPattern = pattern.toLowerCase();

  switch (matchType) {
    case 'EXACT':
      return lowerValue === lowerPattern;
    case 'CONTAINS':
      return lowerValue.includes(lowerPattern);
    case 'STARTS_WITH':
      return lowerValue.startsWith(lowerPattern);
    case 'REGEX':
      try {
        return new RegExp(pattern, 'i').test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function getComparableReferences(
  references: CategorizedReference[],
  type?: string
): CategorizedReference[] {
  if (!type) return references;
  const matchingType = references.filter((r) => r.type === type);
  return matchingType.length > 0 ? matchingType : references;
}

async function buildSuggestionContext(userId: string): Promise<SuggestionContext> {
  const [transactions, rules] = await Promise.all([
    db.transaction.findMany({
      where: {
        account: { userId },
        categoryId: { not: null },
      },
      select: {
        merchantName: true,
        description: true,
        type: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 4000,
    }),
    db.classificationRule.findMany({
      where: {
        userId,
        isActive: true,
        categoryId: { not: null },
      },
      select: {
        id: true,
        name: true,
        priority: true,
        matchField: true,
        matchType: true,
        matchValue: true,
        category: {
          select: { id: true, name: true },
        },
      },
      orderBy: { priority: 'desc' },
    }),
  ]);

  const references: CategorizedReference[] = transactions
    .filter((tx) => !!tx.category)
    .map((tx) => {
      const merchantKey = normalizeMerchantKey(tx.merchantName);
      const descriptionKey = normalizeDescription(tx.description);
      return {
        categoryId: tx.category!.id,
        categoryName: tx.category!.name,
        type: tx.type,
        merchantKey,
        merchantTokens: tokenize(merchantKey || ''),
        descriptionKey,
        descriptionTokens: tokenize(descriptionKey),
      };
    });

  const ruleRefs: RuleReference[] = rules
    .filter((rule) => !!rule.category)
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      matchField: rule.matchField,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
      categoryId: rule.category!.id,
      categoryName: rule.category!.name,
    }));

  return { references, rules: ruleRefs };
}

function normalizeMerchantKey(value: string | null): string | null {
  if (!value) return null;
  const canonical = normalizeVendorName(value);
  const normalized = normalizeText(canonical)
    .replace(/\b(inc|llc|corp|company|store|online)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeDescription(value: string): string {
  return normalizeText(value)
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const aList = Array.from(a);
  const intersectionCount = aList.filter((token) => b.has(token)).length;
  return intersectionCount / Math.max(a.size, b.size);
}

/**
 * Calculate string similarity using Levenshtein distance.
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Suggest categories for uncategorized transactions.
 */
export async function suggestCategoriesForUncategorized(
  userId: string,
  limit: number = 50,
  search?: string,
  accountId?: string
) {
  const normalizedSearch = search?.trim();

  const [context, uncategorized] = await Promise.all([
    buildSuggestionContext(userId),
    db.transaction.findMany({
      where: {
        account: { userId },
        ...(accountId && { accountId }),
        categoryId: null,
        ...(normalizedSearch && {
          OR: [
            { description: { contains: normalizedSearch, mode: 'insensitive' } },
            { merchantName: { contains: normalizedSearch, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        account: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: limit,
    }),
  ]);

  return uncategorized.map((tx) => ({
    transactionId: tx.id,
    transaction: {
      id: tx.id,
      date: tx.date,
      description: tx.description,
      merchantName: tx.merchantName,
      amount: tx.amount,
      type: tx.type,
      classification: tx.classification,
      accountId: tx.accountId,
      accountName: tx.account.name,
    },
    suggestions: suggestCategoryWithContext(
      context,
      tx.merchantName,
      tx.description,
      tx.type
    ),
  }));
}
