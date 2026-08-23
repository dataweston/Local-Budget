import {
  AccountingPeriodStatus,
  JournalEntryStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type DecimalLike = Decimal | string | number;

export type JournalLineDraft = {
  chartAccountId: string;
  description?: string;
  debitAmount?: DecimalLike;
  creditAmount?: DecimalLike;
  legalOwnerId?: string;
  custodyAccountId?: string;
  taxCode?: string;
};

export class JournalInvariantError extends Error {}

function decimal(value: DecimalLike | undefined, field: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value ?? 0);
  } catch {
    throw new JournalInvariantError(`${field} must be a valid decimal amount`);
  }
  if (!parsed.isFinite() || parsed.decimalPlaces() > 4) {
    throw new JournalInvariantError(`${field} must be finite and have at most 4 decimals`);
  }
  return parsed;
}

export function validateJournalLines(lines: JournalLineDraft[]) {
  if (lines.length < 2) {
    throw new JournalInvariantError('a journal entry requires at least two lines');
  }

  let debitTotal = new Decimal(0);
  let creditTotal = new Decimal(0);
  const normalized = lines.map((line, index) => {
    if (!line.chartAccountId.trim()) {
      throw new JournalInvariantError(`line ${index + 1} requires a chart account`);
    }
    const debitAmount = decimal(line.debitAmount, `line ${index + 1} debitAmount`);
    const creditAmount = decimal(line.creditAmount, `line ${index + 1} creditAmount`);
    const hasDebit = debitAmount.gt(0);
    const hasCredit = creditAmount.gt(0);
    if (hasDebit === hasCredit) {
      throw new JournalInvariantError(
        `line ${index + 1} must contain exactly one positive debit or credit`
      );
    }
    debitTotal = debitTotal.plus(debitAmount);
    creditTotal = creditTotal.plus(creditAmount);
    return { ...line, debitAmount, creditAmount };
  });

  if (!debitTotal.eq(creditTotal)) {
    throw new JournalInvariantError(
      `journal is not balanced: debits ${debitTotal.toFixed(4)} != credits ${creditTotal.toFixed(4)}`
    );
  }

  return { lines: normalized, debitTotal, creditTotal };
}

export function assertJournalPostable(input: {
  periodStatus: AccountingPeriodStatus | string;
  lines: JournalLineDraft[];
}) {
  if (input.periodStatus === AccountingPeriodStatus.CLOSED || input.periodStatus === 'CLOSED') {
    throw new JournalInvariantError('cannot post to a closed accounting period');
  }
  return validateJournalLines(input.lines);
}

export function assertJournalMutable(input: {
  entryStatus: JournalEntryStatus | string;
  periodStatus: AccountingPeriodStatus | string;
}) {
  if (
    input.entryStatus === JournalEntryStatus.POSTED ||
    input.entryStatus === JournalEntryStatus.REVERSED ||
    input.periodStatus === AccountingPeriodStatus.CLOSED ||
    input.entryStatus === 'POSTED' ||
    input.entryStatus === 'REVERSED' ||
    input.periodStatus === 'CLOSED'
  ) {
    throw new JournalInvariantError('posted, reversed, or closed journal entries are immutable');
  }
}

type ReversalComparableLine = {
  chartAccountId: string;
  legalOwnerId?: string | null;
  custodyAccountId?: string | null;
  taxCode?: string | null;
  debitAmount?: DecimalLike;
  creditAmount?: DecimalLike;
};

function reversalLineKey(line: ReversalComparableLine, reverseAmounts: boolean): string {
  const debit = decimal(
    reverseAmounts ? line.creditAmount : line.debitAmount,
    'reversal debitAmount'
  ).toFixed(4);
  const credit = decimal(
    reverseAmounts ? line.debitAmount : line.creditAmount,
    'reversal creditAmount'
  ).toFixed(4);
  return [
    line.chartAccountId,
    line.legalOwnerId ?? '',
    line.custodyAccountId ?? '',
    line.taxCode ?? '',
    debit,
    credit,
  ].join('|');
}

export function assertExactReversal(
  originalLines: ReversalComparableLine[],
  reversalLines: ReversalComparableLine[]
) {
  const original = originalLines.map((line) => reversalLineKey(line, true)).sort();
  const reversal = reversalLines.map((line) => reversalLineKey(line, false)).sort();
  if (original.length !== reversal.length || original.some((line, index) => line !== reversal[index])) {
    throw new JournalInvariantError(
      'a linked reversal must exactly invert the original accounts, attribution, and amounts'
    );
  }
}

export type PostJournalEntryInput = {
  userId: string;
  periodId: string;
  entryDate: Date;
  description: string;
  sourceEventId?: string;
  reversalOfId?: string;
  lines: JournalLineDraft[];
};

/**
 * Persists a balanced entry as DRAFT plus lines, then transitions it to
 * POSTED. The database trigger independently validates the final transition.
 */
export async function postJournalEntry(db: PrismaClient, input: PostJournalEntryInput) {
  if (!input.description.trim()) throw new JournalInvariantError('description is required');
  const checked = validateJournalLines(input.lines);

  return db.$transaction(async (tx) => {
    const period = await tx.accountingPeriod.findFirst({
      where: { id: input.periodId, userId: input.userId },
    });
    if (!period) throw new JournalInvariantError('accounting period is not owned by this user');
    if (period.status === AccountingPeriodStatus.CLOSED) {
      throw new JournalInvariantError('cannot post to a closed accounting period');
    }
    if (input.entryDate < period.startsAt || input.entryDate >= period.endsAt) {
      throw new JournalInvariantError('entry date is outside the accounting period');
    }

    const accountIds = Array.from(new Set(checked.lines.map((line) => line.chartAccountId)));
    const accounts = await tx.chartAccount.findMany({
      where: { userId: input.userId, id: { in: accountIds }, isActive: true },
      select: { id: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new JournalInvariantError('every journal line must use an active account owned by the user');
    }

    const ownerIds = Array.from(
      new Set(
        checked.lines
          .map((line) => line.legalOwnerId)
          .filter((id): id is string => Boolean(id))
      )
    );
    const custodyAccountIds = Array.from(
      new Set(
        checked.lines
          .map((line) => line.custodyAccountId)
          .filter((id): id is string => Boolean(id))
      )
    );
    const [owners, custodyAccounts] = await Promise.all([
      tx.entity.findMany({ where: { userId: input.userId, id: { in: ownerIds } }, select: { id: true } }),
      tx.financialAccount.findMany({
        where: { userId: input.userId, id: { in: custodyAccountIds } },
        select: { id: true },
      }),
    ]);
    if (owners.length !== ownerIds.length) {
      throw new JournalInvariantError('every legal owner must be an entity owned by the user');
    }
    if (custodyAccounts.length !== custodyAccountIds.length) {
      throw new JournalInvariantError('every custody account must be owned by the user');
    }
    if (input.sourceEventId) {
      const sourceEvent = await tx.sourceEvent.findFirst({
        where: { id: input.sourceEventId, userId: input.userId },
        select: { id: true },
      });
      if (!sourceEvent) {
        throw new JournalInvariantError('source event is not owned by this user');
      }
    }
    if (input.reversalOfId) {
      const original = await tx.journalEntry.findFirst({
        where: {
          id: input.reversalOfId,
          userId: input.userId,
          status: JournalEntryStatus.POSTED,
          reversals: { none: {} },
        },
        include: { lines: true },
      });
      if (!original) {
        throw new JournalInvariantError(
          'reversal target must be an unreversed posted entry owned by this user'
        );
      }
      assertExactReversal(original.lines, checked.lines);
    }

    const entry = await tx.journalEntry.create({
      data: {
        userId: input.userId,
        periodId: input.periodId,
        entryDate: input.entryDate,
        description: input.description.trim(),
        sourceEventId: input.sourceEventId,
        reversalOfId: input.reversalOfId,
        status: JournalEntryStatus.DRAFT,
        lines: {
          create: checked.lines.map((line) => ({
            chartAccountId: line.chartAccountId,
            description: line.description,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            legalOwnerId: line.legalOwnerId,
            custodyAccountId: line.custodyAccountId,
            taxCode: line.taxCode,
          })),
        },
      },
    });

    return tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: JournalEntryStatus.POSTED, postedAt: new Date() },
      include: { lines: true },
    });
  });
}
