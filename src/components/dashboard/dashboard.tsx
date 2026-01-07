'use client';

import { api } from '@/lib/trpc';
import { Header } from './header';
import { StatsCards } from './stats-cards';
import { CashflowChart } from './cashflow-chart';
import { RecentTransactions } from './recent-transactions';
import { AccountsOverview } from './accounts-overview';
import { CategoryBreakdown } from './category-breakdown';
import { AlertsPanel } from './alerts-panel';
import { Skeleton } from '@/components/ui/skeleton';

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = api.dashboard.stats.useQuery();
  const { data: cashflow, isLoading: cashflowLoading } = api.dashboard.cashflow.useQuery();
  const { data: accounts, isLoading: accountsLoading } = api.accounts.balances.useQuery();
  const { data: categorySpend, isLoading: categoryLoading } = api.categories.spending.useQuery();
  const { data: recentActivity, isLoading: activityLoading } = api.dashboard.recentActivity.useQuery();

  const isLoading = statsLoading || cashflowLoading || accountsLoading || categoryLoading || activityLoading;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        {/* Stats Row */}
        <section>
          {statsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : (
            <StatsCards stats={stats!} />
          )}
        </section>

        {/* Alerts */}
        {stats && (stats.pendingReceipts > 0 || stats.unreviewedTransactions > 0) && (
          <section>
            <AlertsPanel
              pendingReceipts={stats.pendingReceipts}
              unreviewedTransactions={stats.unreviewedTransactions}
            />
          </section>
        )}

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Cashflow Chart - spans 2 columns */}
          <section className="lg:col-span-2">
            {cashflowLoading ? (
              <Skeleton className="h-80" />
            ) : (
              <CashflowChart data={cashflow ?? []} />
            )}
          </section>

          {/* Accounts Overview */}
          <section>
            {accountsLoading ? (
              <Skeleton className="h-80" />
            ) : (
              <AccountsOverview accounts={accounts!} />
            )}
          </section>
        </div>

        {/* Bottom Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Transactions */}
          <section>
            {activityLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <RecentTransactions transactions={recentActivity?.transactions ?? []} />
            )}
          </section>

          {/* Category Breakdown */}
          <section>
            {categoryLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <CategoryBreakdown categories={categorySpend ?? []} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
