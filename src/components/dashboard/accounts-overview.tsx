'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, cn } from '@/lib/utils';
import { Plus, CreditCard, Building2, Wallet, PiggyBank } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  type: string;
  currentBalance: number | string | { toString(): string };
  currency: string;
  entity?: { name: string } | null;
}

interface AccountsOverviewProps {
  accounts: {
    accounts: Account[];
    totalBalance: number;
  };
}

const accountTypeIcons: Record<string, any> = {
  CHECKING: Building2,
  SAVINGS: PiggyBank,
  CREDIT_CARD: CreditCard,
  CASH: Wallet,
  default: Wallet,
};

export function AccountsOverview({ accounts }: AccountsOverviewProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>
            Total: {formatCurrency(accounts.totalBalance)}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon">
          <Plus className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {accounts.accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <Wallet className="h-8 w-8" />
            <p className="text-sm">No accounts yet</p>
            <Button variant="outline" size="sm">
              Add Account
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.accounts.map((account) => {
              const balance = Number(account.currentBalance);
              const Icon = accountTypeIcons[account.type] || accountTypeIcons.default;

              return (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{account.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {account.type.replace('_', ' ')}
                        </Badge>
                        {account.entity && (
                          <span className="text-xs text-muted-foreground">
                            {account.entity.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'font-semibold',
                      balance >= 0 ? 'text-foreground' : 'text-red-600'
                    )}
                  >
                    {formatCurrency(balance)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
