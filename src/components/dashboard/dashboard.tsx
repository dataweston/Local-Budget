'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { api } from '@/lib/trpc';
import { Header } from './header';
import { StatsCards } from './stats-cards';
import { CashflowChart } from './cashflow-chart';
import { RecentTransactions } from './recent-transactions';
import { AccountsOverview } from './accounts-overview';
import { CategoryBreakdown } from './category-breakdown';
import { AlertsPanel } from './alerts-panel';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DateRangeSelector,
  type PeriodPreset,
  getDateRangeForPreset,
} from '@/components/ui/date-range-selector';

function getChartPeriod(startDate: Date, endDate: Date): 'daily' | 'weekly' | 'monthly' {
  const days = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 62) return 'daily';
  if (days <= 180) return 'weekly';
  return 'monthly';
}

export function Dashboard() {
  const [period, setPeriod] = useState<PeriodPreset>('this-month');
  const [yearValue, setYearValue] = useState<number>(new Date().getFullYear());
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const dateRange = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      const start = new Date(customStart);
      const end = new Date(customEnd + 'T23:59:59.999');
      return { startDate: start, endDate: end, label: 'Custom Range' };
    }
    return getDateRangeForPreset(period, { year: yearValue });
  }, [period, yearValue, customStart, customEnd]);

  const { data: stats, isLoading: statsLoading } = api.dashboard.stats.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const { data: cashflow, isLoading: cashflowLoading } = api.dashboard.cashflow.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    period: getChartPeriod(dateRange.startDate, dateRange.endDate),
  });

  const { data: accounts, isLoading: accountsLoading } = api.accounts.balances.useQuery();

  const { data: categorySpend, isLoading: categoryLoading } = api.categories.spending.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    type: 'EXPENSE',
  });

  const { data: incomeByCategory, isLoading: incomeLoading } = api.categories.spending.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    type: 'INCOME',
  });

  const { data: recentActivity, isLoading: activityLoading } = api.dashboard.recentActivity.useQuery();

  // Fetch linked accounts for auto-sync
  const { data: allAccounts } = api.accounts.list.useQuery();
  const utils = api.useUtils();
  const syncAttempted = useRef(false);

  // Auto-sync on page refresh (not on client-side navigation)
  useEffect(() => {
    if (syncAttempted.current || !allAccounts) return;

    const SYNC_DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes
    const lastSync = sessionStorage.getItem('lb-last-sync');
    if (lastSync && Date.now() - parseInt(lastSync, 10) < SYNC_DEBOUNCE_MS) return;

    syncAttempted.current = true;

    const linkedAccounts = allAccounts.filter(
      (a) => a.plaidItemId || a.squareConnectionId
    );
    if (linkedAccounts.length === 0) return;

    // Deduplicate Plaid items
    const plaidItemIds = Array.from(
      new Set(linkedAccounts.filter((a) => a.plaidItemId).map((a) => a.plaidItemId))
    ).filter(Boolean) as string[];

    const squareAccountIds = linkedAccounts
      .filter((a) => a.squareConnectionId)
      .map((a) => a.id);

    const syncAll = async () => {
      const promises: Promise<unknown>[] = [];
      for (const plaidItemId of plaidItemIds) {
        promises.push(
          fetch('/api/plaid/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plaidItemId, fullSync: false }),
          }).catch(() => {})
        );
      }
      for (const accountId of squareAccountIds) {
        promises.push(
          fetch('/api/square/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId }),
          }).catch(() => {})
        );
      }
      await Promise.allSettled(promises);
      sessionStorage.setItem('lb-last-sync', String(Date.now()));
      // Invalidate queries so dashboard picks up new data
      utils.dashboard.invalidate();
      utils.accounts.invalidate();
      utils.categories.invalidate();
    };

    syncAll();
  }, [allAccounts, utils]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        {/* Period Selector */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <DateRangeSelector
            value={period}
            onChange={setPeriod}
            yearValue={yearValue}
            onYearChange={setYearValue}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />
        </div>

        {/* Stats Row */}
        <section>
          {statsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : (
            <StatsCards stats={stats!} periodLabel={dateRange.label} />
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

        {/* Category Breakdowns */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Expense Category Breakdown */}
          <section>
            {categoryLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <CategoryBreakdown
                categories={categorySpend ?? []}
                title="Spending by Category"
                description={`${dateRange.label} expenses`}
              />
            )}
          </section>

          {/* Income Category Breakdown */}
          <section>
            {incomeLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <CategoryBreakdown
                categories={incomeByCategory ?? []}
                title="Income by Source"
                description={`${dateRange.label} income`}
              />
            )}
          </section>
        </div>

        {/* Recent Transactions */}
        <section>
          {activityLoading ? (
            <Skeleton className="h-96" />
          ) : (
            <RecentTransactions transactions={recentActivity?.transactions ?? []} />
          )}
        </section>
      </main>
    </div>
  );
}
