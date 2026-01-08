import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

export const transactionLinksRouter = createTRPCRouter({
  // Create a link between two transactions
  create: protectedProcedure
    .input(
      z.object({
        fromId: z.string(),
        toId: z.string(),
        linkType: z.enum(['REIMBURSEMENT', 'TRANSFER', 'REFUND', 'RELATED']),
        amount: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership of both transactions
      const [fromTx, toTx] = await Promise.all([
        ctx.db.transaction.findFirst({
          where: {
            id: input.fromId,
            account: { userId: ctx.session.user.id },
          },
        }),
        ctx.db.transaction.findFirst({
          where: {
            id: input.toId,
            account: { userId: ctx.session.user.id },
          },
        }),
      ]);

      if (!fromTx || !toTx) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'One or both transactions not found',
        });
      }

      // Create the link
      const link = await ctx.db.transactionLink.create({
        data: {
          fromId: input.fromId,
          toId: input.toId,
          linkType: input.linkType,
          amount: input.amount,
          notes: input.notes,
        },
        include: {
          fromTransaction: {
            select: {
              id: true,
              date: true,
              description: true,
              amount: true,
            },
          },
          toTransaction: {
            select: {
              id: true,
              date: true,
              description: true,
              amount: true,
            },
          },
        },
      });

      return link;
    }),

  // Get all links for a transaction (both incoming and outgoing)
  getByTransactionId: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      // Get links where this transaction is either the source or target
      const [linksFrom, linksTo] = await Promise.all([
        ctx.db.transactionLink.findMany({
          where: { fromId: input.transactionId },
          include: {
            toTransaction: {
              select: {
                id: true,
                date: true,
                description: true,
                amount: true,
                merchantName: true,
              },
            },
          },
        }),
        ctx.db.transactionLink.findMany({
          where: { toId: input.transactionId },
          include: {
            fromTransaction: {
              select: {
                id: true,
                date: true,
                description: true,
                amount: true,
                merchantName: true,
              },
            },
          },
        }),
      ]);

      return {
        outgoing: linksFrom,
        incoming: linksTo,
      };
    }),

  // Delete a link
  delete: protectedProcedure
    .input(z.object({ linkId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Find the link and verify ownership
      const link = await ctx.db.transactionLink.findUnique({
        where: { id: input.linkId },
        include: {
          fromTransaction: {
            include: { account: { select: { userId: true } } },
          },
          toTransaction: {
            include: { account: { select: { userId: true } } },
          },
        },
      });

      if (!link) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Link not found',
        });
      }

      // Verify user owns both transactions
      if (
        link.fromTransaction.account.userId !== ctx.session.user.id ||
        link.toTransaction.account.userId !== ctx.session.user.id
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete this link',
        });
      }

      await ctx.db.transactionLink.delete({
        where: { id: input.linkId },
      });

      return { success: true };
    }),

  // Find potential link candidates based on amount and date similarity
  findCandidates: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        maxResults: z.number().optional().default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get the source transaction
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      // Get existing links to exclude
      const existingLinks = await ctx.db.transactionLink.findMany({
        where: {
          OR: [
            { fromId: input.transactionId },
            { toId: input.transactionId },
          ],
        },
        select: {
          fromId: true,
          toId: true,
        },
      });

      const excludeIds = [
        input.transactionId,
        ...existingLinks.flatMap((l) => [l.fromId, l.toId]),
      ];

      // Convert amount to number for calculations
      const amount = Number(transaction.amount);
      const amountTolerance = Math.abs(amount) * 0.05; // 5% tolerance
      const minAmount = amount - amountTolerance;
      const maxAmount = amount + amountTolerance;

      // Search for similar transactions within 30 days
      const dateStart = new Date(transaction.date);
      dateStart.setDate(dateStart.getDate() - 30);
      const dateEnd = new Date(transaction.date);
      dateEnd.setDate(dateEnd.getDate() + 30);

      const candidates = await ctx.db.transaction.findMany({
        where: {
          id: { notIn: excludeIds },
          account: { userId: ctx.session.user.id },
          date: {
            gte: dateStart,
            lte: dateEnd,
          },
          // Look for opposite type (income vs expense) or similar amounts
          OR: [
            {
              amount: {
                gte: minAmount,
                lte: maxAmount,
              },
            },
            {
              amount: {
                gte: -maxAmount,
                lte: -minAmount,
              },
            },
          ],
        },
        include: {
          account: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          date: 'desc',
        },
        take: input.maxResults,
      });

      // Calculate match scores
      const candidatesWithScores = candidates.map((candidate) => {
        const candidateAmount = Number(candidate.amount);
        const amountDiff = Math.abs(Math.abs(candidateAmount) - Math.abs(amount));
        const amountScore = Math.max(0, 1 - amountDiff / Math.abs(amount));

        const dateDiff = Math.abs(
          candidate.date.getTime() - transaction.date.getTime()
        );
        const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
        const dateScore = Math.max(0, 1 - daysDiff / 30);

        // Higher score for opposite type transactions
        const typeScore =
          candidate.type !== transaction.type ? 0.5 : 0;

        const totalScore = amountScore * 0.5 + dateScore * 0.3 + typeScore * 0.2;

        return {
          ...candidate,
          matchScore: totalScore,
        };
      });

      // Sort by match score
      candidatesWithScores.sort((a, b) => b.matchScore - a.matchScore);

      return candidatesWithScores;
    }),
});
