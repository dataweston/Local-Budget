import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

const classificationEnum = z.enum([
  'COGS',
  'OPERATING',
  'PERSONAL',
  'INCOME',
  'TRANSFER',
  'REIMBURSABLE',
  'REIMBURSEMENT',
]);

const splitItemSchema = z.object({
  amount: z.number(),
  categoryId: z.string().optional(),
  classification: classificationEnum.optional(),
  incurredById: z.string().optional(),
  description: z.string().optional(),
});

export const splitsRouter = createTRPCRouter({
  // Get splits for a transaction
  getByTransactionId: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
        select: { id: true, amount: true },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      const splits = await ctx.db.transactionSplit.findMany({
        where: { transactionId: input.transactionId },
        include: {
          category: {
            select: { id: true, name: true, icon: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return {
        transactionAmount: transaction.amount,
        splits,
      };
    }),

  // Create or replace splits for a transaction
  save: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        splits: z.array(splitItemSchema).min(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
        select: { id: true, amount: true },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      // Validate that split amounts sum to the transaction amount
      const totalSplit = input.splits.reduce((sum, s) => sum + s.amount, 0);
      const txAmount = Math.abs(Number(transaction.amount));
      const tolerance = 0.01;

      if (Math.abs(totalSplit - txAmount) > tolerance) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Split amounts (${totalSplit.toFixed(2)}) must equal the transaction amount (${txAmount.toFixed(2)})`,
        });
      }

      // Delete existing splits and create new ones in a transaction
      const result = await ctx.db.$transaction(async (tx) => {
        await tx.transactionSplit.deleteMany({
          where: { transactionId: input.transactionId },
        });

        const splits = await Promise.all(
          input.splits.map((split) =>
            tx.transactionSplit.create({
              data: {
                transactionId: input.transactionId,
                amount: split.amount,
                categoryId: split.categoryId || null,
                classification: split.classification as any || null,
                incurredById: split.incurredById || null,
                description: split.description || null,
              },
              include: {
                category: {
                  select: { id: true, name: true, icon: true },
                },
              },
            })
          )
        );

        return splits;
      });

      return result;
    }),

  // Apply a 2-way split template to many transactions
  bulkApplyTemplate: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()).min(1),
        template: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('PERSONAL_BUSINESS'),
            businessPercent: z.number().gt(0).lt(100),
            businessCategoryId: z.string().optional(),
            personalCategoryId: z.string().optional(),
          }),
          z.object({
            kind: z.literal('CATEGORY_PAIR'),
            firstCategoryId: z.string(),
            secondCategoryId: z.string(),
            firstPercent: z.number().gt(0).lt(100),
            firstClassification: classificationEnum.optional(),
            secondClassification: classificationEnum.optional(),
          }),
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const transactionIds = Array.from(new Set(input.transactionIds));

      const transactions = await ctx.db.transaction.findMany({
        where: {
          id: { in: transactionIds },
          account: { userId: ctx.session.user.id },
        },
        select: {
          id: true,
          amount: true,
          categoryId: true,
        },
      });

      if (transactions.length !== transactionIds.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Some transactions not found',
        });
      }

      if (
        input.template.kind === 'CATEGORY_PAIR' &&
        input.template.firstCategoryId === input.template.secondCategoryId
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Select two different categories.',
        });
      }

      const categoryIdsToValidate = new Set<string>();
      if (input.template.kind === 'PERSONAL_BUSINESS') {
        if (input.template.businessCategoryId) {
          categoryIdsToValidate.add(input.template.businessCategoryId);
        }
        if (input.template.personalCategoryId) {
          categoryIdsToValidate.add(input.template.personalCategoryId);
        }
      } else {
        categoryIdsToValidate.add(input.template.firstCategoryId);
        categoryIdsToValidate.add(input.template.secondCategoryId);
      }

      if (categoryIdsToValidate.size > 0) {
        const categories = await ctx.db.category.findMany({
          where: {
            id: { in: Array.from(categoryIdsToValidate) },
            userId: ctx.session.user.id,
          },
          select: { id: true },
        });
        if (categories.length !== categoryIdsToValidate.size) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'One or more selected categories were not found.',
          });
        }
      }

      const getSplitAmounts = (rawAmount: number, firstPercent: number) => {
        const absAmount = Math.abs(rawAmount);
        const firstAmount = Number(((absAmount * firstPercent) / 100).toFixed(2));
        const secondAmount = Number((absAmount - firstAmount).toFixed(2));
        if (firstAmount <= 0 || secondAmount <= 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'One or more transactions are too small to split with this percentage.',
          });
        }
        return { firstAmount, secondAmount };
      };

      await ctx.db.$transaction(async (tx) => {
        for (const transaction of transactions) {
          if (input.template.kind === 'PERSONAL_BUSINESS') {
            const { firstAmount: businessAmount, secondAmount: personalAmount } =
              getSplitAmounts(
                Number(transaction.amount),
                input.template.businessPercent
              );

            await tx.transactionSplit.deleteMany({
              where: { transactionId: transaction.id },
            });

            await tx.transactionSplit.createMany({
              data: [
                {
                  transactionId: transaction.id,
                  amount: businessAmount,
                  categoryId:
                    input.template.businessCategoryId ??
                    transaction.categoryId ??
                    null,
                  classification: 'OPERATING',
                  description: 'Business portion',
                },
                {
                  transactionId: transaction.id,
                  amount: personalAmount,
                  categoryId:
                    input.template.personalCategoryId ??
                    transaction.categoryId ??
                    null,
                  classification: 'PERSONAL',
                  description: 'Personal portion',
                },
              ],
            });
          } else {
            const { firstAmount, secondAmount } = getSplitAmounts(
              Number(transaction.amount),
              input.template.firstPercent
            );

            await tx.transactionSplit.deleteMany({
              where: { transactionId: transaction.id },
            });

            await tx.transactionSplit.createMany({
              data: [
                {
                  transactionId: transaction.id,
                  amount: firstAmount,
                  categoryId: input.template.firstCategoryId,
                  classification:
                    (input.template.firstClassification as any) ?? null,
                  description: 'Bulk category split',
                },
                {
                  transactionId: transaction.id,
                  amount: secondAmount,
                  categoryId: input.template.secondCategoryId,
                  classification:
                    (input.template.secondClassification as any) ?? null,
                  description: 'Bulk category split',
                },
              ],
            });
          }

          await tx.transaction.update({
            where: { id: transaction.id },
            data: { isReviewed: true },
          });
        }
      });

      return { success: true, count: transactionIds.length };
    }),

  // Generate transaction splits from linked receipt/invoice line items
  createFromReceipt: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        receiptId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const transaction = await ctx.db.transaction.findFirst({
        where: {
          id: input.transactionId,
          account: { userId: ctx.session.user.id },
        },
        select: {
          id: true,
          amount: true,
          classification: true,
          categoryId: true,
          receiptLinks: {
            select: { receiptId: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transaction not found',
        });
      }

      const candidateReceiptId = input.receiptId ?? transaction.receiptLinks[0]?.receiptId;
      if (!candidateReceiptId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No linked receipt found for this transaction.',
        });
      }

      const receipt = await ctx.db.receipt.findFirst({
        where: {
          id: candidateReceiptId,
          userId: ctx.session.user.id,
        },
        include: {
          lineItems: {
            where: {
              totalPrice: { gt: 0 },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!receipt) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Receipt not found',
        });
      }

      if (receipt.lineItems.length < 2) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Need at least 2 invoice line items to auto-generate splits.',
        });
      }

      const txAmount = Math.abs(Number(transaction.amount));
      const lineTotal = receipt.lineItems.reduce((sum, li) => sum + Math.abs(Number(li.totalPrice)), 0);
      if (txAmount <= 0 || lineTotal <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid transaction or line item amount.',
        });
      }

      const draftAmounts = receipt.lineItems.map((li) =>
        Number(((Math.abs(Number(li.totalPrice)) / lineTotal) * txAmount).toFixed(2))
      );
      const draftSumExceptLast = draftAmounts.slice(0, -1).reduce((sum, amt) => sum + amt, 0);
      draftAmounts[draftAmounts.length - 1] = Number((txAmount - draftSumExceptLast).toFixed(2));

      const splits = await ctx.db.$transaction(async (tx) => {
        await tx.transactionSplit.deleteMany({
          where: { transactionId: input.transactionId },
        });

        const created = [];
        for (let i = 0; i < receipt.lineItems.length; i++) {
          const li = receipt.lineItems[i];
          const amount = draftAmounts[i];
          if (amount <= 0) continue;
          const split = await tx.transactionSplit.create({
            data: {
              transactionId: input.transactionId,
              amount,
              categoryId: li.categoryId ?? transaction.categoryId ?? null,
              classification: (li.classification ?? transaction.classification) as any,
              description: li.description,
            },
          });
          created.push(split);
        }

        return created;
      });

      return { success: true, count: splits.length, receiptId: receipt.id };
    }),

  // Remove all splits from a transaction
  remove: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
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

      await ctx.db.transactionSplit.deleteMany({
        where: { transactionId: input.transactionId },
      });

      return { success: true };
    }),
});
