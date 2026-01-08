import { db } from '@/lib/db';

/**
 * ML-based category suggestion engine
 * Uses historical data, fuzzy matching, and keyword rules to suggest categories
 */

interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  confidence: number;
  reason: string;
}

/**
 * Main category suggestion function
 */
export async function suggestCategory(
  userId: string,
  merchantName: string | null,
  description: string
): Promise<CategorySuggestion[]> {
  const suggestions: CategorySuggestion[] = [];

  // Try exact merchant match first
  const exactMatch = await findExactMerchantMatch(userId, merchantName);
  if (exactMatch) {
    suggestions.push({
      categoryId: exactMatch.id,
      categoryName: exactMatch.name,
      confidence: 0.95,
      reason: 'Exact merchant match',
    });
  }

  // Try fuzzy merchant match
  if (merchantName && suggestions.length === 0) {
    const fuzzyMatch = await findFuzzyMerchantMatch(userId, merchantName);
    if (fuzzyMatch) {
      suggestions.push({
        categoryId: fuzzyMatch.id,
        categoryName: fuzzyMatch.name,
        confidence: 0.75,
        reason: 'Similar merchant match',
      });
    }
  }

  // Try keyword rules
  const ruleMatches = await matchKeywordRules(userId, merchantName, description);
  for (const match of ruleMatches) {
    // Don't add duplicate suggestions
    if (!suggestions.find((s) => s.categoryId === match.categoryId)) {
      suggestions.push({
        categoryId: match.categoryId,
        categoryName: match.categoryName,
        confidence: 0.65,
        reason: `Rule match: "${match.ruleName}"`,
      });
    }
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);

  // Return top 3 suggestions
  return suggestions.slice(0, 3);
}

/**
 * Find exact merchant match from historical transactions
 */
async function findExactMerchantMatch(
  userId: string,
  merchantName: string | null
): Promise<{ id: string; name: string } | null> {
  if (!merchantName) return null;

  // Find most common category for this exact merchant
  const result = await db.transaction.groupBy({
    by: ['categoryId'],
    where: {
      account: { userId },
      merchantName: merchantName,
      categoryId: { not: null },
    },
    _count: {
      categoryId: true,
    },
    orderBy: {
      _count: {
        categoryId: 'desc',
      },
    },
    take: 1,
  });

  if (result.length === 0 || !result[0].categoryId) return null;

  const category = await db.category.findUnique({
    where: { id: result[0].categoryId },
    select: { id: true, name: true },
  });

  return category;
}

/**
 * Find fuzzy merchant match using Levenshtein distance
 */
async function findFuzzyMerchantMatch(
  userId: string,
  merchantName: string
): Promise<{ id: string; name: string } | null> {
  // Get all unique merchants for the user with their most common category
  const transactions = await db.transaction.findMany({
    where: {
      account: { userId },
      merchantName: { not: null },
      categoryId: { not: null },
    },
    select: {
      merchantName: true,
      categoryId: true,
    },
    distinct: ['merchantName'],
  });

  // Find best fuzzy match
  let bestMatch: { merchant: string; categoryId: string; distance: number } | null = null;
  const threshold = 0.7; // 70% similarity threshold

  for (const tx of transactions) {
    if (!tx.merchantName || !tx.categoryId) continue;
    const similarity = calculateSimilarity(merchantName, tx.merchantName);
    
    if (similarity >= threshold) {
      if (!bestMatch || similarity > (1 - bestMatch.distance)) {
        bestMatch = {
          merchant: tx.merchantName,
          categoryId: tx.categoryId,
          distance: 1 - similarity,
        };
      }
    }
  }

  if (!bestMatch) return null;

  const category = await db.category.findUnique({
    where: { id: bestMatch.categoryId },
    select: { id: true, name: true },
  });

  return category;
}

/**
 * Match against active classification rules
 */
async function matchKeywordRules(
  userId: string,
  merchantName: string | null,
  description: string
): Promise<Array<{ categoryId: string; categoryName: string; ruleName: string }>> {
  const rules = await db.classificationRule.findMany({
    where: {
      userId,
      isActive: true,
      categoryId: { not: null },
    },
    include: {
      category: {
        select: { id: true, name: true },
      },
    },
    orderBy: {
      priority: 'desc',
    },
  });

  const matches: Array<{ categoryId: string; categoryName: string; ruleName: string }> = [];

  for (const rule of rules) {
    if (!rule.category) continue;

    const searchText = rule.matchField === 'merchantName' 
      ? (merchantName || '').toLowerCase()
      : description.toLowerCase();

    const matchValue = rule.matchValue.toLowerCase();
    let isMatch = false;

    switch (rule.matchType) {
      case 'EXACT':
        isMatch = searchText === matchValue;
        break;
      case 'CONTAINS':
        isMatch = searchText.includes(matchValue);
        break;
      case 'STARTS_WITH':
        isMatch = searchText.startsWith(matchValue);
        break;
      case 'REGEX':
        try {
          const regex = new RegExp(rule.matchValue, 'i');
          isMatch = regex.test(searchText);
        } catch (e) {
          // Invalid regex, skip
        }
        break;
    }

    if (isMatch) {
      matches.push({
        categoryId: rule.category.id,
        categoryName: rule.category.name,
        ruleName: rule.name,
      });
    }
  }

  return matches;
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;

  // Create matrix
  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  
  return 1 - distance / maxLen;
}

/**
 * Suggest categories for all uncategorized transactions
 */
export async function suggestCategoriesForUncategorized(
  userId: string,
  limit: number = 50
) {
  const uncategorized = await db.transaction.findMany({
    where: {
      account: { userId },
      categoryId: null,
    },
    orderBy: {
      date: 'desc',
    },
    take: limit,
  });

  const suggestions = await Promise.all(
    uncategorized.map(async (tx) => {
      const categorySuggestions = await suggestCategory(
        userId,
        tx.merchantName,
        tx.description
      );

      return {
        transactionId: tx.id,
        transaction: {
          id: tx.id,
          date: tx.date,
          description: tx.description,
          merchantName: tx.merchantName,
          amount: tx.amount,
        },
        suggestions: categorySuggestions,
      };
    })
  );

  return suggestions;
}
