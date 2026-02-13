import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { updateReceiptSchema, linkReceiptSchema } from '@/lib/schemas';
import { generateReceiptEmail } from '@/lib/email/parser';
import {
  getAmazonCategoryTargets,
  getAmazonRoutingCategoryId,
  isAmazonTransactionText,
  isAmazonVideoTransactionText,
} from '@/lib/amazon-routing';
import { getEffectiveClassification } from '@/lib/transaction-filters';

export const receiptsRouter = createTRPCRouter({
  // List receipts
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVIEWED']).optional(),
        hasTransaction: z.boolean().optional(),
        page: z.number().default(1),
        limit: z.number().default(20),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const skip = (page - 1) * limit;

      const where: any = { userId: ctx.session.user.id };
      if (input?.status) where.status = input.status;

      const [receipts, total] = await Promise.all([
        ctx.db.receipt.findMany({
          where,
          include: {
            transactionLinks: {
              include: {
                transaction: {
                  select: { id: true, description: true, amount: true, date: true },
                },
              },
            },
            _count: { select: { lineItems: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        ctx.db.receipt.count({ where }),
      ]);

      // Filter by hasTransaction if specified
      let filtered = receipts;
      if (input?.hasTransaction !== undefined) {
        filtered = receipts.filter((r) =>
          input.hasTransaction
            ? r.transactionLinks.length > 0
            : r.transactionLinks.length === 0
        );
      }

      return {
        data: filtered,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }),

  // Get single receipt
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          lineItems: {
            include: {
              vendor: true,
              item: true,
            },
          },
          transactionLinks: {
            include: {
              transaction: true,
            },
          },
        },
      });
      return receipt;
    }),

  // Update receipt
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateReceiptSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.receipt.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Receipt not found');

      const receipt = await ctx.db.receipt.update({
        where: { id: input.id },
        data: input.data,
      });
      return receipt;
    }),

  // Delete receipt
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const existing = await ctx.db.receipt.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!existing) throw new Error('Receipt not found');

      await ctx.db.receipt.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),

  // Link receipt to transaction
  linkToTransaction: protectedProcedure
    .input(linkReceiptSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify ownership of both receipt and transaction
      const [receipt, transaction] = await Promise.all([
        ctx.db.receipt.findFirst({
          where: { id: input.receiptId, userId: ctx.session.user.id },
        }),
        ctx.db.transaction.findFirst({
          where: { id: input.transactionId, account: { userId: ctx.session.user.id } },
        }),
      ]);
      if (!receipt || !transaction) throw new Error('Receipt or transaction not found');

      const link = await ctx.db.receiptTransaction.create({
        data: {
          receiptId: input.receiptId,
          transactionId: input.transactionId,
          isManual: input.isManual,
        },
      });
      return link;
    }),

  // Unlink receipt from transaction
  unlinkFromTransaction: protectedProcedure
    .input(
      z.object({
        receiptId: z.string(),
        transactionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, userId: ctx.session.user.id },
      });
      if (!receipt) throw new Error('Receipt not found');

      await ctx.db.receiptTransaction.deleteMany({
        where: {
          receiptId: input.receiptId,
          transactionId: input.transactionId,
        },
      });
      return { success: true };
    }),

  // Get pending count
  pendingCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await ctx.db.receipt.count({
      where: { userId: ctx.session.user.id, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    return count;
  }),

  // Get unlinked receipts
  unlinked: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const receipts = await ctx.db.receipt.findMany({
        where: {
          userId: ctx.session.user.id,
          transactionLinks: { none: {} },
          status: { in: ['PROCESSED', 'REVIEWED'] },
        },
        take: input?.limit ?? 10,
        orderBy: { createdAt: 'desc' },
      });
      return receipts;
    }),

  // Ingested Amazon spending from order-history imports
  amazonSpending: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(1000).default(250),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          accountId: z.string().optional(),
          matchFilter: z.enum(['all', 'matched', 'unmatched', 'pending']).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const amazonFilter = {
        OR: [
          { description: { contains: 'amazon', mode: 'insensitive' as const } },
          { description: { contains: 'amzn', mode: 'insensitive' as const } },
          { merchantName: { contains: 'amazon', mode: 'insensitive' as const } },
          { merchantName: { contains: 'amzn', mode: 'insensitive' as const } },
        ],
      };

      const rows = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          type: 'EXPENSE',
          ...amazonFilter,
          ...(input?.accountId ? { accountId: input.accountId } : {}),
          ...(input?.startDate || input?.endDate
            ? {
                date: {
                  ...(input?.startDate ? { gte: input.startDate } : {}),
                  ...(input?.endDate ? { lte: input.endDate } : {}),
                },
              }
            : {}),
        },
        select: {
          id: true,
          date: true,
          amount: true,
          type: true,
          classification: true,
          categoryId: true,
          description: true,
          merchantName: true,
          metadata: true,
          category: {
            select: {
              id: true,
              name: true,
              defaultClassification: true,
              parent: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          account: {
            select: { id: true, name: true },
          },
          lineItems: {
            where: {
              description: { startsWith: '[Amazon] ' },
            },
            select: {
              id: true,
              description: true,
              totalPrice: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        take: input?.limit ?? 250,
      });

      const allData = rows.map((row) => {
        const effectiveClassification = getEffectiveClassification(row);
        const metadata = row.metadata as Record<string, unknown> | null;
        const amazonOrderMatch =
          metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata) &&
          metadata.amazonOrderMatch &&
          typeof metadata.amazonOrderMatch === 'object'
            ? (metadata.amazonOrderMatch as Record<string, unknown>)
            : null;
        const hasAmazonIngestMatch = !!amazonOrderMatch;
        // Legacy matches (no matchStatus field) are treated as approved
        const matchStatus: string | null = hasAmazonIngestMatch
          ? (typeof amazonOrderMatch?.matchStatus === 'string'
              ? amazonOrderMatch.matchStatus as string
              : 'approved')
          : null;
        const isVideo = isAmazonVideoTransactionText({
          description: row.description,
          merchantName: row.merchantName,
        });
        return {
          ...row,
          effectiveClassification,
          hasAmazonIngestMatch,
          matchStatus,
          isVideo,
        };
      });

      // Apply match status filter
      const matchFilter = input?.matchFilter ?? 'all';
      let data = allData;
      if (matchFilter === 'matched') {
        data = allData.filter((row) => row.hasAmazonIngestMatch && row.matchStatus === 'approved');
      } else if (matchFilter === 'unmatched') {
        data = allData.filter((row) => !row.hasAmazonIngestMatch);
      } else if (matchFilter === 'pending') {
        data = allData.filter((row) => row.matchStatus === 'pending');
      }

      // Collect unique accounts for the filter dropdown
      const accountMap = new Map<string, string>();
      for (const row of allData) {
        accountMap.set(row.account.id, row.account.name);
      }
      const accounts = Array.from(accountMap, ([id, name]) => ({ id, name }));

      const totalAmount = data.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
      const businessAmount = data
        .filter((row) => row.effectiveClassification !== 'PERSONAL')
        .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
      const personalAmount = data
        .filter((row) => row.effectiveClassification === 'PERSONAL')
        .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);

      return {
        data,
        totalCount: data.length,
        totalAmount,
        businessAmount,
        personalAmount,
        businessCount: data.filter((row) => row.effectiveClassification !== 'PERSONAL').length,
        personalCount: data.filter((row) => row.effectiveClassification === 'PERSONAL').length,
        pendingMatchCount: allData.filter((row) => row.matchStatus === 'pending').length,
        accounts,
      };
    }),

  venmoSpending: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(2000).default(1000),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          typeFilter: z.enum(['income', 'expense']).optional(),
          matchFilter: z.enum(['matched', 'unmatched']).optional(),
          accountId: z.string().optional(),
          sortBy: z.enum(['date-desc', 'date-asc', 'amount-desc', 'amount-asc']).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          ...(input?.typeFilter === 'income'
            ? { type: 'INCOME' as const }
            : input?.typeFilter === 'expense'
              ? { type: 'EXPENSE' as const }
              : { type: { in: ['INCOME', 'EXPENSE'] as const } }),
          OR: [
            { description: { contains: 'venmo', mode: 'insensitive' } },
            { merchantName: { contains: 'venmo', mode: 'insensitive' } },
          ],
          ...(input?.startDate || input?.endDate
            ? {
                date: {
                  ...(input?.startDate ? { gte: input.startDate } : {}),
                  ...(input?.endDate ? { lte: input.endDate } : {}),
                },
              }
            : {}),
        },
        select: {
          id: true,
          date: true,
          amount: true,
          type: true,
          classification: true,
          categoryId: true,
          description: true,
          merchantName: true,
          metadata: true,
          category: {
            select: {
              id: true,
              name: true,
              defaultClassification: true,
              parent: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          account: {
            select: { id: true, name: true },
          },
        },
        orderBy: { date: 'desc' },
      });

      const allData = rows.map((row) => {
        const effectiveClassification = getEffectiveClassification(row);
        const metadata = row.metadata as Record<string, unknown> | null;
        const venmoStatementMatch =
          metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata) &&
          metadata.venmoStatementMatch &&
          typeof metadata.venmoStatementMatch === 'object'
            ? (metadata.venmoStatementMatch as Record<string, unknown>)
            : null;

        return {
          ...row,
          effectiveClassification,
          hasVenmoStatementMatch: !!venmoStatementMatch,
        };
      });

      const matchFilter = input?.matchFilter ?? undefined;
      let filtered = allData;
      if (input?.accountId) {
        filtered = filtered.filter((row) => row.account.id === input.accountId);
      }
      if (matchFilter === 'matched') {
        filtered = filtered.filter((row) => row.hasVenmoStatementMatch);
      } else if (matchFilter === 'unmatched') {
        filtered = filtered.filter((row) => !row.hasVenmoStatementMatch);
      }

      const sortBy = input?.sortBy ?? 'date-desc';
      const sorted = [...filtered].sort((a, b) => {
        if (sortBy === 'date-asc') {
          return a.date.getTime() - b.date.getTime();
        }
        if (sortBy === 'amount-desc') {
          return Math.abs(Number(b.amount)) - Math.abs(Number(a.amount));
        }
        if (sortBy === 'amount-asc') {
          return Math.abs(Number(a.amount)) - Math.abs(Number(b.amount));
        }
        return b.date.getTime() - a.date.getTime();
      });

      const limit = input?.limit ?? 1000;
      const data = sorted.slice(0, limit);

      const incomeAmount = sorted
        .filter((row) => row.type === 'INCOME')
        .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
      const expenseAmount = sorted
        .filter((row) => row.type === 'EXPENSE')
        .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
      const netAmount = incomeAmount - expenseAmount;
      const totalAmount = incomeAmount + expenseAmount;

      const businessAmount = sorted
        .filter((row) => row.effectiveClassification !== 'PERSONAL')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const personalAmount = sorted
        .filter((row) => row.effectiveClassification === 'PERSONAL')
        .reduce((sum, row) => sum + Number(row.amount), 0);

      const accountMap = new Map<string, string>();
      for (const row of allData) {
        accountMap.set(row.account.id, row.account.name);
      }
      const accounts = Array.from(accountMap, ([id, name]) => ({ id, name }));

      return {
        data,
        totalCount: sorted.length,
        totalAmount,
        incomeAmount,
        expenseAmount,
        netAmount,
        businessAmount,
        personalAmount,
        businessCount: sorted.filter((row) => row.effectiveClassification !== 'PERSONAL').length,
        personalCount: sorted.filter((row) => row.effectiveClassification === 'PERSONAL').length,
        incomeCount: sorted.filter((row) => row.type === 'INCOME').length,
        expenseCount: sorted.filter((row) => row.type === 'EXPENSE').length,
        matchedCount: sorted.filter((row) => row.hasVenmoStatementMatch).length,
        unmatchedCount: sorted.filter((row) => !row.hasVenmoStatementMatch).length,
        accounts,
      };
    }),

  // Backfill category routing for Amazon transactions:
  // - Amazon -> Materials > amazon
  // - Amazon + "video" -> Tools and software
  enforceAmazonRouting: protectedProcedure
    .input(
      z
        .object({
          dryRun: z.boolean().default(false),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const targets = await getAmazonCategoryTargets(ctx.db, ctx.session.user.id);
      if (!targets.amazonCategoryId) {
        throw new Error('Missing category: Materials > amazon');
      }
      if (!targets.toolsSoftwareCategoryId) {
        throw new Error('Missing category: Tools and software');
      }

      const rows = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          type: 'EXPENSE',
          OR: [
            { description: { contains: 'amazon', mode: 'insensitive' } },
            { description: { contains: 'amzn', mode: 'insensitive' } },
            { merchantName: { contains: 'amazon', mode: 'insensitive' } },
            { merchantName: { contains: 'amzn', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          description: true,
          merchantName: true,
          categoryId: true,
          classification: true,
        },
      });

      let routedAmazon = 0;
      let routedVideo = 0;
      let updated = 0;

      for (const row of rows) {
        if (!isAmazonTransactionText(row)) continue;
        const targetCategoryId = getAmazonRoutingCategoryId(row, targets);
        if (!targetCategoryId) continue;

        if (targetCategoryId === targets.toolsSoftwareCategoryId) {
          routedVideo++;
        } else {
          routedAmazon++;
        }

        const needsCategoryUpdate = row.categoryId !== targetCategoryId;
        const needsClassificationUpdate = row.classification === null;
        if (!needsCategoryUpdate && !needsClassificationUpdate) continue;
        if (!input?.dryRun) {
          await ctx.db.transaction.update({
            where: { id: row.id },
            data: {
              ...(needsCategoryUpdate ? { categoryId: targetCategoryId } : {}),
              ...(needsClassificationUpdate ? { classification: 'OPERATING' } : {}),
            },
          });
        }
        updated++;
      }

      return {
        scanned: rows.length,
        updated,
        routedAmazon,
        routedVideo,
        dryRun: input?.dryRun ?? false,
      };
    }),

  // Approve an Amazon order match
  approveAmazonMatch: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.transaction.findFirst({
        where: { id: input.transactionId, account: { userId: ctx.session.user.id } },
        select: { id: true, metadata: true },
      });
      if (!tx) throw new Error('Transaction not found');
      const meta = (tx.metadata as Record<string, unknown>) ?? {};
      const amazonMatch = meta.amazonOrderMatch as Record<string, unknown> | undefined;
      if (!amazonMatch) throw new Error('No Amazon match to approve');

      await ctx.db.transaction.update({
        where: { id: tx.id },
        data: {
          metadata: {
            ...meta,
            amazonOrderMatch: {
              ...amazonMatch,
              matchStatus: 'approved',
              approvedAt: new Date().toISOString(),
            },
          },
        },
      });
      return { success: true };
    }),

  // Reject an Amazon order match (removes match data)
  rejectAmazonMatch: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.transaction.findFirst({
        where: { id: input.transactionId, account: { userId: ctx.session.user.id } },
        select: { id: true, metadata: true },
      });
      if (!tx) throw new Error('Transaction not found');
      const meta = (tx.metadata as Record<string, unknown>) ?? {};
      const { amazonOrderMatch: _, ...restMeta } = meta;

      await ctx.db.transaction.update({
        where: { id: tx.id },
        data: {
          metadata: Object.keys(restMeta).length > 0
            ? JSON.parse(JSON.stringify(restMeta))
            : null,
        },
      });
      await ctx.db.lineItem.deleteMany({
        where: { transactionId: tx.id, description: { startsWith: '[Amazon] ' } },
      });
      return { success: true };
    }),

  // Bulk approve Amazon matches
  bulkApproveAmazonMatches: protectedProcedure
    .input(z.object({ transactionIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      let approved = 0;
      for (const txId of input.transactionIds) {
        const tx = await ctx.db.transaction.findFirst({
          where: { id: txId, account: { userId: ctx.session.user.id } },
          select: { id: true, metadata: true },
        });
        if (!tx) continue;
        const meta = (tx.metadata as Record<string, unknown>) ?? {};
        const amazonMatch = meta.amazonOrderMatch as Record<string, unknown> | undefined;
        if (!amazonMatch || amazonMatch.matchStatus === 'approved') continue;
        await ctx.db.transaction.update({
          where: { id: tx.id },
          data: {
            metadata: {
              ...meta,
              amazonOrderMatch: {
                ...amazonMatch,
                matchStatus: 'approved',
                approvedAt: new Date().toISOString(),
              },
            },
          },
        });
        approved++;
      }
      return { approved };
    }),

  // Batch classify Amazon transactions as business/personal
  batchClassifyAmazon: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()),
        classification: z.enum(['OPERATING', 'PERSONAL']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.transaction.count({
        where: {
          id: { in: input.transactionIds },
          account: { userId: ctx.session.user.id },
        },
      });
      if (owned !== input.transactionIds.length) {
        throw new Error('Some transactions not found');
      }
      await ctx.db.transaction.updateMany({
        where: { id: { in: input.transactionIds } },
        data: { classification: input.classification },
      });
      return { success: true, count: input.transactionIds.length };
    }),

  // Find potential matches for a receipt
  findMatches: protectedProcedure
    .input(z.object({ receiptId: z.string() }))
    .query(async ({ ctx, input }) => {
      const receipt = await ctx.db.receipt.findFirst({
        where: { id: input.receiptId, userId: ctx.session.user.id },
      });

      if (!receipt || !receipt.totalAmount) {
        return [];
      }

      // Find transactions with similar amount and date
      const tolerance = 0.01; // 1 cent tolerance
      const dateTolerance = 3; // 3 days

      const potentialMatches = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          amount: {
            gte: Number(receipt.totalAmount) * -1 - tolerance,
            lte: Number(receipt.totalAmount) * -1 + tolerance,
          },
          ...(receipt.receiptDate && {
            date: {
              gte: new Date(
                receipt.receiptDate.getTime() - dateTolerance * 24 * 60 * 60 * 1000
              ),
              lte: new Date(
                receipt.receiptDate.getTime() + dateTolerance * 24 * 60 * 60 * 1000
              ),
            },
          }),
          receiptLinks: { none: {} },
        },
        include: {
          account: { select: { name: true } },
          category: { select: { name: true, icon: true } },
        },
        take: 10,
      });

      return potentialMatches;
    }),

  // Get user's unique inbound receipt email
  getInboundEmail: protectedProcedure.query(async ({ ctx }) => {
    const domain = process.env.RECEIPT_EMAIL_DOMAIN || 'localhost';
    return {
      email: generateReceiptEmail(ctx.session.user.id, domain),
      instructions: 'Forward your receipts to this email address to automatically import them.',
    };
  }),
});
