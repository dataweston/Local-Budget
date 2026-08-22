import { Prisma } from '@prisma/client';

/**
 * Operating reporting uses the originating economic activity.
 *
 * Square payment rows retain customer, gross-sale, fee, refund, tax, and tip
 * detail. A later Plaid deposit carrying the Square payout is settlement cash,
 * not another sale, so a current BANK_SETTLEMENT allocation excludes that bank
 * row from operating reports. Financing withheld from a payout remains in the
 * settlement detail and never becomes an operating expense.
 */
export function operatingReportScope(userId?: string): Prisma.TransactionWhereInput {
  return {
    status: 'POSTED',
    ...(userId ? { account: { userId } } : {}),
    allocations: {
      none: { isCurrent: true, role: 'BANK_SETTLEMENT' },
    },
  };
}

/**
 * Cash reporting uses bank/card-account postings and excludes processor mirror
 * accounts. Square payouts therefore appear once, when cash reaches the bank;
 * gross activity, fees, and financing deductions belong in operating and
 * settlement reports instead.
 */
export function cashReportScope(userId?: string): Prisma.TransactionWhereInput {
  return {
    status: 'POSTED',
    account: {
      ...(userId ? { userId } : {}),
      squareConnectionId: null,
    },
  };
}
