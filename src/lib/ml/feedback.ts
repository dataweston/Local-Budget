/**
 * Records categorization feedback so the categorizer learns from user choices.
 * Called whenever a transaction is categorized via a suggestion or manual pick.
 * Uses the same normalization keys as the categorizer so reads line up exactly.
 */
import type { PrismaClient } from '@prisma/client';
import { normalizeMerchantKey, normalizeDescription } from './categorizer';

export async function recordCategoryFeedback(
  db: Pick<PrismaClient, 'categoryFeedback'>,
  params: {
    userId: string;
    merchantName: string | null;
    description: string;
    type: string;
    categoryId: string;
    wasCorrection?: boolean;
  }
): Promise<void> {
  const merchantKey = normalizeMerchantKey(params.merchantName) ?? '';
  const descriptionKey = normalizeDescription(params.description ?? '');
  // Nothing to key on — skip rather than store an all-empty row.
  if (!merchantKey && !descriptionKey) return;

  await db.categoryFeedback.upsert({
    where: {
      userId_merchantKey_descriptionKey_type_categoryId: {
        userId: params.userId,
        merchantKey,
        descriptionKey,
        type: params.type,
        categoryId: params.categoryId,
      },
    },
    create: {
      userId: params.userId,
      merchantKey,
      descriptionKey,
      type: params.type,
      categoryId: params.categoryId,
      wasCorrection: params.wasCorrection ?? false,
    },
    update: {
      timesConfirmed: { increment: 1 },
      lastConfirmedAt: new Date(),
      ...(params.wasCorrection ? { wasCorrection: true } : {}),
    },
  });
}
