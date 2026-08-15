import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dollarsToCents } from '@/lib/cashflow';
import { authorizeServiceRequest } from '@/lib/service-auth';
import { transactionBalanceEffect } from '@/lib/financial-integrity';

export const dynamic = 'force-dynamic';

function parseAsOf(value: string | null): Date | null {
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(req: NextRequest) {
  const auth = authorizeServiceRequest(
    req,
    process.env.INTEGRATION_API_TOKEN,
    'INTEGRATION_API_TOKEN'
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const asOf = parseAsOf(req.nextUrl.searchParams.get('asOf'));
  if (!asOf) {
    return NextResponse.json(
      { error: 'asOf must use YYYY-MM-DD' },
      { status: 400 }
    );
  }

  const accounts = await db.financialAccount.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      type: true,
      currency: true,
      openingBalance: true,
      openingBalanceDate: true,
      lastSyncedAt: true,
      balanceSnapshots: {
        where: { effectiveAt: { lte: asOf } },
        orderBy: { effectiveAt: 'desc' },
        take: 1,
        select: {
          balance: true,
          effectiveAt: true,
          source: true,
        },
      },
    },
  });

  const accountPositions = await Promise.all(
    accounts.map(async (account) => {
      const snapshot = account.balanceSnapshots[0] ?? null;
      const openingBalance = account.openingBalance;
      const openingBalanceDate = account.openingBalanceDate;
      const anchor = snapshot
        ? {
            balance: Number(snapshot.balance),
            effectiveAt: snapshot.effectiveAt,
            source: snapshot.source,
          }
        : openingBalance !== null &&
            openingBalanceDate !== null &&
            openingBalanceDate <= asOf
          ? {
              balance: Number(openingBalance),
              effectiveAt: openingBalanceDate,
              source: 'OPENING_BALANCE',
            }
          : null;

      if (!anchor) {
        return {
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          balanceCents: null,
          anchor: null,
          postingCount: 0,
          unresolved: true,
          warning: 'No dated balance snapshot or opening balance exists',
        };
      }

      const [postings, backdatedChangeCount] = await Promise.all([
        db.transaction.findMany({
          where: {
            accountId: account.id,
            status: 'POSTED',
            date: { gt: anchor.effectiveAt, lte: asOf },
          },
          select: { amount: true, type: true, status: true, metadata: true },
        }),
        db.transaction.count({
          where: {
            accountId: account.id,
            date: { lte: anchor.effectiveAt },
            updatedAt: { gt: anchor.effectiveAt, lte: asOf },
          },
        }),
      ]);
      const postingEffect = postings.reduce(
        (sum, posting) => sum + transactionBalanceEffect(posting),
        0
      );
      const ambiguousTransfer = postings.some(
        (posting) =>
          posting.type === 'TRANSFER' &&
          (!posting.metadata ||
            typeof posting.metadata !== 'object' ||
            Array.isArray(posting.metadata) ||
            !('transferDirection' in posting.metadata))
      );
      const warning = backdatedChangeCount
        ? `${backdatedChangeCount} backdated change(s) occurred after the balance anchor`
        : ambiguousTransfer
          ? 'One or more transfer postings lack an explicit direction'
          : null;
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        balanceCents: warning
          ? null
          : dollarsToCents(anchor.balance + postingEffect),
        anchor: {
          balanceCents: dollarsToCents(anchor.balance),
          effectiveAt: anchor.effectiveAt.toISOString(),
          source: anchor.source,
        },
        postingCount: postings.length,
        unresolved: warning !== null,
        warning,
      };
    })
  );

  const liquidTypes = new Set(['CHECKING', 'SAVINGS', 'CASH']);
  const resolvedLiquid = accountPositions.filter(
    (position) =>
      liquidTypes.has(position.type) && position.balanceCents !== null
  );

  return NextResponse.json({
    contractVersion: 2,
    methodVersion: 'anchored-cash-position-v1',
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString(),
    totalLiquidCents: resolvedLiquid.reduce(
      (sum, position) => sum + (position.balanceCents ?? 0),
      0
    ),
    unresolvedLiquidAccountIds: accountPositions
      .filter(
        (position) =>
          liquidTypes.has(position.type) && position.balanceCents === null
      )
      .map((position) => position.id),
    accounts: accountPositions,
    quality: {
      unresolvedAccountCount: accountPositions.filter(
        (position) => position.unresolved
      ).length,
      warnings: accountPositions.flatMap((position) =>
        position.warning ? [`${position.name}: ${position.warning}`] : []
      ),
    },
  });
}
