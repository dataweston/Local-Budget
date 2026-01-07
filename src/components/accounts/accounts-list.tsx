'use client';

import { useState } from 'react';
import { api } from '@/lib/trpc';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency, cn } from '@/lib/utils';
import { AddAccountModal } from './AddAccountModal';
import { PlaidLinkButton } from './PlaidLinkButton';
import { SquareConnectButton } from './SquareConnectButton';
import {
  Plus,
  CreditCard,
  Building2,
  Wallet,
  PiggyBank,
  TrendingUp,
  MoreVertical,
  RefreshCw,
  Link2,
  ChevronDown,
  Loader2,
} from 'lucide-react';

const accountTypeIcons: Record<string, any> = {
  CHECKING: Building2,
  SAVINGS: PiggyBank,
  CREDIT_CARD: CreditCard,
  CASH: Wallet,
  INVESTMENT: TrendingUp,
  default: Wallet,
};

const accountTypeColors: Record<string, string> = {
  CHECKING: 'bg-blue-500',
  SAVINGS: 'bg-green-500',
  CREDIT_CARD: 'bg-purple-500',
  CASH: 'bg-yellow-500',
  INVESTMENT: 'bg-cyan-500',
  default: 'bg-gray-500',
};

export function AccountsList() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { data: accounts, isLoading, refetch } = api.accounts.list.useQuery();
  const { data: balances } = api.accounts.balances.useQuery();

  const handleAccountLinked = () => {
    refetch();
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    try {
      // Get all linked accounts and sync them
      const linkedAccounts = accounts?.filter(
        (a) => a.plaidItemId || a.squareConnectionId
      ) || [];

      // Group Plaid accounts by plaidItemId to avoid duplicate syncs
      const plaidItemIds = Array.from(new Set(
        linkedAccounts
          .filter((a) => a.plaidItemId)
          .map((a) => a.plaidItemId)
      )).filter(Boolean) as string[];

      // Sync Plaid accounts
      for (const plaidItemId of plaidItemIds) {
        try {
          await fetch('/api/plaid/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plaidItemId }),
          });
        } catch (error) {
          console.error('Error syncing Plaid item:', plaidItemId, error);
        }
      }

      // Sync Square accounts
      const squareAccounts = linkedAccounts.filter((a) => a.squareConnectionId);
      for (const account of squareAccounts) {
        try {
          await fetch('/api/square/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: account.id }),
          });
        } catch (error) {
          console.error('Error syncing Square account:', account.id, error);
        }
      }

      // Refetch accounts to update balances
      refetch();
    } catch (error) {
      console.error('Error in sync all:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <AddAccountModal open={showAddModal} onOpenChange={setShowAddModal} />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Assets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(
                  accounts
                    ?.filter((a) => Number(a.currentBalance) > 0)
                    .reduce((sum, a) => sum + Number(a.currentBalance), 0) ?? 0
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Liabilities
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">
                {formatCurrency(
                  Math.abs(
                    accounts
                      ?.filter((a) => Number(a.currentBalance) < 0)
                      .reduce((sum, a) => sum + Number(a.currentBalance), 0) ?? 0
                  )
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Net Worth
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={cn(
                  'text-2xl font-bold',
                  (balances?.totalBalance ?? 0) >= 0
                    ? 'text-foreground'
                    : 'text-red-600'
                )}
              >
                {formatCurrency(balances?.totalBalance ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Accounts List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>
                Manage your financial accounts
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSyncAll}
                disabled={isSyncing}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isSyncing && "animate-spin")} />
                {isSyncing ? 'Syncing...' : 'Sync All'}
              </Button>
              
              {/* Connect External Account Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Link2 className="h-4 w-4 mr-2" />
                    Connect Account
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56" forceMount>
                  <DropdownMenuLabel>Link External Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <PlaidLinkButton 
                      onSuccess={handleAccountLinked}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start cursor-pointer"
                    />
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <SquareConnectButton 
                      onSuccess={handleAccountLinked}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start cursor-pointer"
                    />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              <Button size="sm" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Account
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {accounts?.map((account) => {
                  const balance = Number(account.currentBalance);
                  const Icon =
                    accountTypeIcons[account.type] || accountTypeIcons.default;
                  const colorClass =
                    accountTypeColors[account.type] || accountTypeColors.default;

                  return (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={cn(
                            'flex h-12 w-12 items-center justify-center rounded-full text-white',
                            colorClass
                          )}
                        >
                          <Icon className="h-6 w-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{account.name}</p>
                            {account.entity && (
                              <Badge variant="secondary" className="text-xs">
                                {account.entity.name}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{account.type.replace('_', ' ')}</span>
                            {account.institution && (
                              <>
                                <span>•</span>
                                <span>{account.institution}</span>
                              </>
                            )}
                            {account.accountNumber && (
                              <>
                                <span>•</span>
                                <span>••••{account.accountNumber}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p
                            className={cn(
                              'text-xl font-bold',
                              balance >= 0 ? 'text-foreground' : 'text-red-600'
                            )}
                          >
                            {formatCurrency(balance)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {account._count.transactions} transactions
                          </p>
                        </div>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
