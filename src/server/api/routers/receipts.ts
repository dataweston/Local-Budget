import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { updateReceiptSchema, linkReceiptSchema } from '@/lib/schemas';
import { generateReceiptEmail } from '@/lib/email/parser';

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
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.transaction.findMany({
        where: {
          account: { userId: ctx.session.user.id },
          type: 'EXPENSE',
          metadata: {
            path: ['amazonOrderMatch', 'source'],
            equals: 'amazon-orders-html',
          },
        },
        select: {
          id: true,
          date: true,
          amount: true,
          description: true,
          merchantName: true,
          metadata: true,
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

      const totalAmount = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);

      return {
        data: rows,
        totalCount: rows.length,
        totalAmount,
      };
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
