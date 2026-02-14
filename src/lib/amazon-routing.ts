import type { PrismaClient } from '@prisma/client';

type TxLike = {
  description?: string | null;
  merchantName?: string | null;
};

export type AmazonCategoryTargets = {
  amazonCategoryId: string | null;
  toolsSoftwareCategoryId: string | null;
};

export type AmazonRoutingClassification = 'OPERATING' | 'PERSONAL';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isAmazonTransactionText(input: TxLike): boolean {
  const text = normalize(`${input.description ?? ''} ${input.merchantName ?? ''}`);
  return text.includes('amazon') || text.includes('amzn');
}

/** Detects Amazon digital subscriptions (Prime Video, Audible, Kindle, Music Unlimited). */
export function isAmazonDigitalSubscriptionText(input: TxLike): boolean {
  const text = normalize(`${input.description ?? ''} ${input.merchantName ?? ''}`);
  return (
    /\bprime\s*video\b/.test(text) ||
    /\bamzn?\s*digital\b/.test(text) ||
    /\bdigital\s*(services?|svcs?)\b/.test(text) ||
    /\baudible\b/.test(text) ||
    /\bkindle\b/.test(text) ||
    /\bmusic\s*unlimited\b/.test(text)
  );
}

/** @deprecated Use isAmazonDigitalSubscriptionText instead. */
export const isAmazonVideoTransactionText = isAmazonDigitalSubscriptionText;

export function getAmazonRoutingClassification(
  input: TxLike
): AmazonRoutingClassification | null {
  if (!isAmazonTransactionText(input)) return null;
  return isAmazonDigitalSubscriptionText(input) ? 'PERSONAL' : 'OPERATING';
}

export function getAmazonRoutingCategoryId(
  input: TxLike,
  targets: AmazonCategoryTargets
): string | null {
  if (!isAmazonTransactionText(input)) return null;
  if (isAmazonDigitalSubscriptionText(input)) {
    return targets.toolsSoftwareCategoryId ?? targets.amazonCategoryId ?? null;
  }
  return targets.amazonCategoryId;
}

export async function getAmazonCategoryTargets(
  db: PrismaClient,
  userId: string
): Promise<AmazonCategoryTargets> {
  const [amazonCategory, toolsSoftwareCategory] = await Promise.all([
    db.category.findFirst({
      where: {
        userId,
        name: { equals: 'amazon', mode: 'insensitive' },
        parent: {
          is: {
            userId,
            name: { equals: 'materials', mode: 'insensitive' },
          },
        },
      },
      select: { id: true },
    }),
    db.category.findFirst({
      where: {
        userId,
        OR: [
          { name: { equals: 'tools and software', mode: 'insensitive' } },
          { name: { equals: 'software & tools', mode: 'insensitive' } },
          { name: { equals: 'software and tools', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    }),
  ]);

  return {
    amazonCategoryId: amazonCategory?.id ?? null,
    toolsSoftwareCategoryId: toolsSoftwareCategory?.id ?? null,
  };
}
