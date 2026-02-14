'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/trpc';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, cn } from '@/lib/utils';
import {
  DateRangeSelector,
  getDateRangeForPreset,
  type PeriodPreset,
} from '@/components/ui/date-range-selector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { CHART_COLORS, CLASSIFICATION_STYLES } from '@/lib/colors';
import * as M from '@/lib/metrics';

type SortOrder = 'asc' | 'desc';
type CategorySort = 'amount' | 'name' | 'classification' | 'count' | 'share';
type VendorSort = 'spending' | 'name' | 'count';

const CLASS_ORDER: Record<string, number> = {
  INCOME: 0,
  REIMBURSEMENT: 1,
  COGS: 2,
  OPERATING: 3,
  REIMBURSABLE: 4,
  PERSONAL: 5,
};

const sortRows = <T,>(
  rows: T[],
  order: SortOrder,
  compare: (a: T, b: T) => number
): T[] => {
  const sorted = [...rows].sort(compare);
  return order === 'asc' ? sorted : sorted.reverse();
};

export function ReportsView() {
  const [period, setPeriod] = useState<PeriodPreset>('this-month');
  const [yearValue, setYearValue] = useState<number>(new Date().getFullYear());
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [categorySortBy, setCategorySortBy] = useState<CategorySort>('amount');
  const [categorySortOrder, setCategorySortOrder] = useState<SortOrder>('desc');
  const [expenseSortBy, setExpenseSortBy] = useState<CategorySort>('amount');
  const [expenseSortOrder, setExpenseSortOrder] = useState<SortOrder>('desc');
  const [vendorSortBy, setVendorSortBy] = useState<VendorSort>('spending');
  const [vendorSortOrder, setVendorSortOrder] = useState<SortOrder>('desc');

  const dateRange = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return {
        startDate: new Date(customStart + 'T00:00:00'),
        endDate: new Date(customEnd + 'T23:59:59.999'),
        label: 'Custom',
      };
    }
    return getDateRangeForPreset(period, { year: yearValue });
  }, [period, yearValue, customStart, customEnd]);

  const dateInput = { startDate: dateRange.startDate, endDate: dateRange.endDate };
  const { data: profitLoss, isLoading: plLoading } = api.dashboard.profitLoss.useQuery(dateInput);
  const { data: stats } = api.dashboard.stats.useQuery(dateInput);
  const { data: cashflow, isLoading: cashflowLoading } = api.dashboard.cashflow.useQuery({
    ...dateInput,
    period: 'monthly',
  });
  const { data: categorySpend, isLoading: catLoading } = api.categories.spendingClusters.useQuery({
    ...dateInput,
    clusterLimit: 4,
  });
  const { data: incomeByCategory, isLoading: incomeLoading } = api.categories.spendingClusters.useQuery({
    ...dateInput,
    type: 'INCOME',
    clusterLimit: 4,
  });
  const { data: vendorData, isLoading: vendorLoading } = api.vendors.list.useQuery({
    ...dateInput,
    sortBy: 'spending',
    sortOrder: 'desc',
    limit: 100,
  });

  const pnlCategoryRows = useMemo(() => {
    if (!profitLoss) return [];
    return sortRows(profitLoss.byCategory, categorySortOrder, (a, b) => {
      switch (categorySortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'classification':
          return (CLASS_ORDER[a.classification] ?? 999) - (CLASS_ORDER[b.classification] ?? 999);
        case 'count':
          return a.transactionCount - b.transactionCount;
        case 'share':
          return a.percentOfTotal - b.percentOfTotal;
        default:
          return a.amount - b.amount;
      }
    });
  }, [profitLoss, categorySortBy, categorySortOrder]);

  const expenseRows = useMemo(() => {
    const rows = (categorySpend ?? []).map((row) => ({
      ...row,
      displayName: row.parentCategoryName
        ? `${row.parentCategoryName} > ${row.categoryName}`
        : row.categoryName,
    }));
    return sortRows(rows, expenseSortOrder, (a, b) => {
      switch (expenseSortBy) {
        case 'name':
          return a.displayName.localeCompare(b.displayName);
        case 'classification':
          return 0;
        case 'count':
          return a.transactionCount - b.transactionCount;
        case 'share':
          return a.percentOfTotal - b.percentOfTotal;
        default:
          return a.amount - b.amount;
      }
    });
  }, [categorySpend, expenseSortBy, expenseSortOrder]);

  const incomeRows = useMemo(() => {
    return (incomeByCategory ?? []).map((row) => ({
      ...row,
      displayName: row.parentCategoryName
        ? `${row.parentCategoryName} > ${row.categoryName}`
        : row.categoryName,
    }));
  }, [incomeByCategory]);

  const vendorRows = useMemo(() => {
    const rows = (vendorData?.vendors ?? []).filter((v) => v.totalSpending > 0);
    return sortRows(rows, vendorSortOrder, (a, b) => {
      switch (vendorSortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'count':
          return (a.spendingCount ?? a.count) - (b.spendingCount ?? b.count);
        default:
          return a.totalSpending - b.totalSpending;
      }
    });
  }, [vendorData?.vendors, vendorSortBy, vendorSortOrder]);

  const cashflowTotals = useMemo(() => {
    return (cashflow ?? []).reduce(
      (acc, row) => ({
        income: acc.income + row.income,
        expenses: acc.expenses + row.expenses,
        net: acc.net + row.net,
      }),
      { income: 0, expenses: 0, net: 0 }
    );
  }, [cashflow]);

  const healthCards = useMemo(() => {
    if (!profitLoss) return [];
    const runway = M.cashRunwayMonths({
      currentBalance: stats?.totalBalance ?? 0,
      monthlyBurnRate: profitLoss.averageMonthlyExpenses,
      monthlyOperatingBurn: profitLoss.operatingBurnRate,
    });
    const cogsRatio = M.cogsRatio({ revenue: profitLoss.revenue, cogs: profitLoss.cogs });
    const opexRatio = M.opexRatio({
      revenue: profitLoss.revenue,
      operatingExpenses: profitLoss.operatingExpenses,
    });
    return [
      ['Gross Margin', `${profitLoss.grossMargin.toFixed(1)}%`],
      ['Operating Margin', `${profitLoss.operatingMargin.toFixed(1)}%`],
      ['Net Margin', `${profitLoss.netMargin.toFixed(1)}%`],
      ['Savings Rate', `${profitLoss.savingsRate.toFixed(1)}%`],
      ['COGS Ratio', `${cogsRatio.toFixed(1)}%`],
      ['OpEx Ratio', `${opexRatio.toFixed(1)}%`],
      ['Avg Monthly Revenue', formatCurrency(profitLoss.averageMonthlyRevenue)],
      ['Avg Monthly Expenses', formatCurrency(profitLoss.averageMonthlyExpenses)],
      ['Operating Burn / Mo', formatCurrency(profitLoss.operatingBurnRate)],
      ['Revenue / Expense', `${profitLoss.expenseCoverageRatio.toFixed(2)}x`],
      ['Top Expense Concentration', `${profitLoss.topExpenseCategoryShare.toFixed(1)}%`],
      ['Cash Runway', Number.isFinite(runway) ? `${runway.toFixed(1)} mo` : 'Infinity'],
      ['Uncategorized Spend', formatCurrency(profitLoss.uncategorizedAmount)],
    ];
  }, [profitLoss, stats?.totalBalance]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Reports</h1>
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

        <Tabs defaultValue="pnl">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="pnl">Profit & Loss</TabsTrigger>
            <TabsTrigger value="income-vs-expense">Income vs Expense</TabsTrigger>
            <TabsTrigger value="categories">Expense Categories</TabsTrigger>
            <TabsTrigger value="income-sources">Income Sources</TabsTrigger>
            <TabsTrigger value="top-vendors">Top Vendors</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="mt-6">
            {plLoading || !profitLoss ? (
              <Skeleton className="h-96" />
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Profit & Loss Summary</CardTitle>
                    <CardDescription>{dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between"><span>Revenue</span><span className="font-bold text-income">{formatCurrency(profitLoss.revenue)}</span></div>
                    <div className="flex justify-between"><span>COGS</span><span className="text-expense">({formatCurrency(profitLoss.cogs)})</span></div>
                    <div className="flex justify-between"><span>Operating Expenses</span><span className="text-expense">({formatCurrency(profitLoss.operatingExpenses)})</span></div>
                    <div className="flex justify-between"><span>Personal</span><span className="text-expense">({formatCurrency(profitLoss.personalExpenses)})</span></div>
                    <div className="flex justify-between font-bold"><span>Net Income</span><span className={cn(profitLoss.netIncome >= 0 ? 'text-income' : 'text-expense')}>{formatCurrency(profitLoss.netIncome)}</span></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Financial Health</CardTitle>
                    <CardDescription>Expanded metrics</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {healthCards.map(([label, value]) => (
                        <div key={label} className="rounded border px-3 py-2">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="font-semibold">{value}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle>By Category</CardTitle>
                        <CardDescription>Sortable, aligned category lines</CardDescription>
                      </div>
                  <div className="flex gap-2">
                        <Select value={categorySortBy} onValueChange={(v) => setCategorySortBy(v as CategorySort)}>
                          <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="amount">Sort: Amount</SelectItem>
                            <SelectItem value="share">Sort: Share</SelectItem>
                            <SelectItem value="count">Sort: Tx Count</SelectItem>
                            <SelectItem value="classification">Sort: Class</SelectItem>
                            <SelectItem value="name">Sort: Name</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={categorySortOrder} onValueChange={(v) => setCategorySortOrder(v as SortOrder)}>
                          <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desc">Desc</SelectItem>
                            <SelectItem value="asc">Asc</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left p-2">Class</th>
                            <th className="text-left p-2">Category</th>
                            <th className="text-right p-2">Tx</th>
                            <th className="text-right p-2">Share</th>
                            <th className="text-right p-2">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pnlCategoryRows.map((row) => (
                            <tr key={`${row.categoryId}-${row.classification}-${row.name}`} className="border-b last:border-0">
                              <td className="p-2">
                                <span className={cn('text-xs px-2 py-0.5 rounded border', CLASSIFICATION_STYLES[row.classification] ?? 'bg-slate-50 text-slate-700 border-slate-200')}>{row.classification}</span>
                              </td>
                              <td className="p-2 font-medium">{row.name}</td>
                              <td className="p-2 text-right text-muted-foreground">{row.transactionCount}</td>
                              <td className="p-2 text-right text-muted-foreground">{row.percentOfTotal.toFixed(1)}%</td>
                              <td className="p-2 text-right font-semibold">{formatCurrency(row.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="income-vs-expense" className="mt-6">
            {cashflowLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Income vs Expenses</CardTitle>
                  <CardDescription>{dateRange.label}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={cashflow ?? []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Bar dataKey="income" name="Income" fill={CHART_COLORS.income} />
                      <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS.expense} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Income</p><p className="font-semibold text-income">{formatCurrency(cashflowTotals.income)}</p></div>
                    <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Expenses</p><p className="font-semibold text-expense">{formatCurrency(cashflowTotals.expenses)}</p></div>
                    <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Net</p><p className={cn('font-semibold', cashflowTotals.net >= 0 ? 'text-income' : 'text-expense')}>{formatCurrency(cashflowTotals.net)}</p></div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            {catLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle>Expense Categories</CardTitle>
                      <CardDescription>
                        Split-aware category aggregation with inferred sub-clusters
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Select value={expenseSortBy} onValueChange={(v) => setExpenseSortBy(v as CategorySort)}>
                        <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">Sort: Amount</SelectItem>
                          <SelectItem value="share">Sort: Share</SelectItem>
                          <SelectItem value="count">Sort: Tx Count</SelectItem>
                          <SelectItem value="name">Sort: Name</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={expenseSortOrder} onValueChange={(v) => setExpenseSortOrder(v as SortOrder)}>
                        <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="desc">Desc</SelectItem>
                          <SelectItem value="asc">Asc</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={expenseRows.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="displayName" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="amount" fill={CHART_COLORS.primary} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left p-2">Category</th>
                          <th className="text-left p-2">Inferred Clusters</th>
                          <th className="text-right p-2">Tx</th>
                          <th className="text-right p-2">Share</th>
                          <th className="text-right p-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenseRows.map((row) => (
                          <tr key={`${row.categoryId}-${row.displayName}`} className="border-b last:border-0">
                            <td className="p-2 font-medium">{row.displayName}</td>
                            <td className="p-2">
                              <div className="flex flex-wrap gap-1.5">
                                {(row.clusters ?? []).map((cluster) => (
                                  <span
                                    key={cluster.clusterKey}
                                    className="inline-flex items-center rounded border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                                    title={`${cluster.transactionCount} tx • ${cluster.percentOfCategory.toFixed(1)}%`}
                                  >
                                    {cluster.clusterLabel} ({formatCurrency(cluster.amount)})
                                  </span>
                                ))}
                              </div>
                              {row.totalClusterCount > (row.clusters?.length ?? 0) && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  +{row.totalClusterCount - (row.clusters?.length ?? 0)} more clusters
                                </p>
                              )}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">{row.transactionCount}</td>
                            <td className="p-2 text-right text-muted-foreground">{row.percentOfTotal.toFixed(1)}%</td>
                            <td className="p-2 text-right font-semibold">{formatCurrency(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="income-sources" className="mt-6">
            {incomeLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Income Sources</CardTitle>
                  <CardDescription>
                    Category-level income with inferred source clusters for {dateRange.label}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={incomeRows.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="displayName" width={170} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="amount" fill={CHART_COLORS.income} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left p-2">Category</th>
                          <th className="text-left p-2">Inferred Clusters</th>
                          <th className="text-right p-2">Tx</th>
                          <th className="text-right p-2">Share</th>
                          <th className="text-right p-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incomeRows.map((row) => (
                          <tr key={`${row.categoryId}-${row.displayName}`} className="border-b last:border-0">
                            <td className="p-2 font-medium">{row.displayName}</td>
                            <td className="p-2">
                              <div className="flex flex-wrap gap-1.5">
                                {(row.clusters ?? []).map((cluster) => (
                                  <span
                                    key={cluster.clusterKey}
                                    className="inline-flex items-center rounded border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                                    title={`${cluster.transactionCount} tx • ${cluster.percentOfCategory.toFixed(1)}%`}
                                  >
                                    {cluster.clusterLabel} ({formatCurrency(cluster.amount)})
                                  </span>
                                ))}
                              </div>
                              {row.totalClusterCount > (row.clusters?.length ?? 0) && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  +{row.totalClusterCount - (row.clusters?.length ?? 0)} more clusters
                                </p>
                              )}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">{row.transactionCount}</td>
                            <td className="p-2 text-right text-muted-foreground">{row.percentOfTotal.toFixed(1)}%</td>
                            <td className="p-2 text-right font-semibold text-income">{formatCurrency(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="top-vendors" className="mt-6">
            {vendorLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle>Top Vendors</CardTitle>
                      <CardDescription>Date-scoped vendor spend ({dateRange.label})</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Select value={vendorSortBy} onValueChange={(v) => setVendorSortBy(v as VendorSort)}>
                        <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="spending">Sort: Spending</SelectItem>
                          <SelectItem value="count">Sort: Tx Count</SelectItem>
                          <SelectItem value="name">Sort: Name</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={vendorSortOrder} onValueChange={(v) => setVendorSortOrder(v as SortOrder)}>
                        <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="desc">Desc</SelectItem>
                          <SelectItem value="asc">Asc</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={vendorRows.slice(0, 12)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="totalSpending" fill={CHART_COLORS.primary} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left p-2">Vendor</th>
                          <th className="text-right p-2">Tx</th>
                          <th className="text-right p-2">Spend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorRows.map((row) => (
                          <tr key={row.name} className="border-b last:border-0">
                            <td className="p-2 font-medium">{row.name}</td>
                            <td className="p-2 text-right text-muted-foreground">{row.spendingCount ?? row.count}</td>
                            <td className="p-2 text-right font-semibold">{formatCurrency(row.totalSpending)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
