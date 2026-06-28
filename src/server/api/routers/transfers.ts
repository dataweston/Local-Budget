import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { reconcileInternalTransfers } from '@/lib/transfers/service';

export const transfersRouter = createTRPCRouter({
  /**
   * Preview internal-transfer reconciliation without writing. Returns matched
   * pairs, owner draws/contributions (boundary crossings), and inbound money
   * with no internal counterpart (candidate true income / investor funds).
   */
  preview: protectedProcedure
    .input(
      z
        .object({
          maxDayGap: z.number().min(0).max(30).optional(),
          amountTolerance: z.number().min(0).optional(),
          since: z.date().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return reconcileInternalTransfers(ctx.db, ctx.session.user.id, {
        ...input,
        apply: false,
      });
    }),

  /**
   * Apply reconciliation: mark matched legs as TRANSFER, link them, and tag
   * boundary crossings (owner_draw / owner_contribution) for review.
   */
  apply: protectedProcedure
    .input(
      z
        .object({
          maxDayGap: z.number().min(0).max(30).optional(),
          amountTolerance: z.number().min(0).optional(),
          since: z.date().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return reconcileInternalTransfers(ctx.db, ctx.session.user.id, {
        ...input,
        apply: true,
      });
    }),

  /**
   * Transfer exceptions for the review queue: boundary-crossing transfers
   * (owner draws/contributions) already tagged, plus any transaction flagged
   * via metadata.transferException.
   */
  exceptions: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.transaction.findMany({
      where: {
        account: { userId: ctx.session.user.id },
        metadata: { path: ['transferException'], not: 'null' as any },
      },
      select: {
        id: true,
        date: true,
        amount: true,
        type: true,
        description: true,
        merchantName: true,
        metadata: true,
        account: { select: { name: true, entity: { select: { name: true, type: true } } } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      amount: Number(r.amount),
      type: r.type,
      description: r.description,
      merchantName: r.merchantName,
      accountName: r.account.name,
      entityName: r.account.entity?.name ?? null,
      reason: (r.metadata as any)?.transferException ?? null,
    }));
  }),
});
