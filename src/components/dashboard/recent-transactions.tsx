'use client';

import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { ArrowRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface Transaction {
  id: string;
  description: string;
  amount: number | string | { toString(): string };
  type: string;
  date: Date | string;
  merchantName?: string | null;
  account?: { name: string } | null;
  category?: { name: string; icon: string | null } | null;
}

interface RecentTransactionsProps {
  transactions: Transaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>Your latest financial activity</CardDescription>
        </div>
        <Button variant="ghost" size="sm" className="gap-1" asChild>
          <Link href="/transactions">
            View all
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No transactions yet
          </div>
        ) : (
          <div className="space-y-4">
            {transactions.slice(0, 8).map((tx) => {
              const amount = Number(tx.amount);
              const isIncome = tx.type === 'INCOME';

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-full text-lg',
                        isIncome ? 'bg-green-100' : 'bg-red-100'
                      )}
                    >
                      {tx.category?.icon || (isIncome ? '💰' : '💸')}
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {tx.merchantName || tx.description}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(tx.date)}</span>
                        {tx.account && (
                          <>
                            <span>•</span>
                            <span>{tx.account.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'font-semibold',
                        isIncome ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {isIncome ? '+' : '-'}
                      {formatCurrency(amount)}
                    </span>
                    {isIncome ? (
                      <ArrowUpRight className="h-4 w-4 text-green-600" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-red-600" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
