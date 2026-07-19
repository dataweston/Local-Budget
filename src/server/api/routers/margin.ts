import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';

/**
 * In-app margin analytics (Margin Edge roadmap Phase 4, surfaced).
 *
 * The integration API (/api/integration/v1/items, /v1/price-drift) has served
 * this data to the brain since Phase C — these procedures expose the same
 * signals to the app UI, scoped to the signed-in user:
 *   - priceDrift: per-item unit-price trend from receipt/invoice line items
 *     (cost side — what you pay vendors).
 *   - itemSales: per-item revenue rollup from Square order line items
 *     (sales side — what customers buy).
 */

type PricePoint = { date: string; unitPrice: number };

export const marginRouter = createTRPCRouter({
  priceDrift: protectedProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          minPoints: z.number().min(1).max(50).default(2),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const lines = await ctx.db.lineItem.findMany({
        where: {
          unitPrice: { not: null },
          lineType: 'ITEM',
          // Cost side only: expense transactions or receipts.
          OR: [
            { transaction: { type: 'EXPENSE', account: { userId } } },
            { receipt: { userId } },
          ],
        },
        select: {
          unitPrice: true,
          quantity: true,
          description: true,
          itemId: true,
          item: { select: { name: true, unitOfMeasure: true } },
          vendor: { select: { name: true } },
          transaction: { select: { date: true } },
          receipt: { select: { receiptDate: true, createdAt: true } },
        },
      });

      const startDate = input?.startDate ?? null;
      const endDate = input?.endDate ?? null;
      const minPoints = input?.minPoints ?? 2;

      const groups = new Map<
        string,
        {
          itemId: string | null;
          itemName: string;
          unitOfMeasure: string | null;
          vendorNames: Set<string>;
          points: { date: Date; unitPrice: number }[];
        }
      >();

      for (const li of lines) {
        const date =
          li.transaction?.date ?? li.receipt?.receiptDate ?? li.receipt?.createdAt ?? null;
        if (!date) continue;
        if (startDate && date < startDate) continue;
        if (endDate && date > endDate) continue;

        const name = li.item?.name ?? li.description;
        const key = li.itemId ?? `desc:${name.toLowerCase()}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            itemId: li.itemId,
            itemName: name,
            unitOfMeasure: li.item?.unitOfMeasure ?? null,
            vendorNames: new Set(),
            points: [],
          };
          groups.set(key, g);
        }
        if (li.vendor?.name) g.vendorNames.add(li.vendor.name);
        g.points.push({ date, unitPrice: Number(li.unitPrice) });
      }

      const items = [];
      for (const g of Array.from(groups.values())) {
        if (g.points.length < minPoints) continue;
        g.points.sort((a, b) => a.date.getTime() - b.date.getTime());
        const prices = g.points.map((p) => p.unitPrice);
        const first = prices[0];
        const last = prices[prices.length - 1];
        items.push({
          itemId: g.itemId,
          itemName: g.itemName,
          unitOfMeasure: g.unitOfMeasure,
          vendors: Array.from(g.vendorNames),
          observations: g.points.length,
          firstUnitPrice: first,
          lastUnitPrice: last,
          minUnitPrice: Math.min(...prices),
          maxUnitPrice: Math.max(...prices),
          pctChange: first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0,
          points: g.points.map(
            (p): PricePoint => ({ date: p.date.toISOString(), unitPrice: p.unitPrice })
          ),
        });
      }

      items.sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));
      return { items, count: items.length };
    }),

  itemSales: protectedProcedure
    .input(
      z
        .object({
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          limit: z.number().min(1).max(500).default(100),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const lines = await ctx.db.lineItem.findMany({
        where: {
          lineType: 'ITEM',
          transaction: {
            type: 'INCOME',
            account: { userId },
            ...(input?.startDate || input?.endDate
              ? {
                  date: {
                    ...(input?.startDate ? { gte: input.startDate } : {}),
                    ...(input?.endDate ? { lte: input.endDate } : {}),
                  },
                }
              : {}),
          },
        },
        select: {
          description: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          transaction: { select: { date: true } },
        },
      });

      const byItem = new Map<
        string,
        {
          itemName: string;
          unitsSold: number;
          revenue: number;
          orderCount: number;
          lastSold: Date | null;
        }
      >();

      for (const li of lines) {
        const key = li.description.toLowerCase();
        let row = byItem.get(key);
        if (!row) {
          row = {
            itemName: li.description,
            unitsSold: 0,
            revenue: 0,
            orderCount: 0,
            lastSold: null,
          };
          byItem.set(key, row);
        }
        row.unitsSold += Number(li.quantity ?? 1);
        row.revenue += Number(li.totalPrice);
        row.orderCount += 1;
        const d = li.transaction?.date ?? null;
        if (d && (!row.lastSold || d > row.lastSold)) row.lastSold = d;
      }

      const items = Array.from(byItem.values())
        .map((r) => ({
          ...r,
          avgPrice: r.unitsSold > 0 ? r.revenue / r.unitsSold : r.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, input?.limit ?? 100);

      const totalRevenue = items.reduce((s, r) => s + r.revenue, 0);
      return { items, totalRevenue, count: items.length };
    }),
});
