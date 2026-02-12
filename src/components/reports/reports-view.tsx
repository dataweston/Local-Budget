'use client';

import { useState, useMemo } from 'react';
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
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

import { CHART_COLORS, CHART_PALETTE, CLASSIFICATION_STYLES } from '@/lib/colors';
import * as M from '@/lib/metrics';

export function ReportsView() {
  // Date range state
  const [period, setPeriod] = useState<PeriodPreset>('this-month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const dateRange = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      const start = new Date(customStart + 'T00:00:00');
      const end = new Date(customEnd + 'T23:59:59.999');
      return { startDate: start, endDate: end, label: 'Custom' };
    }
    return getDateRangeForPreset(period);
  }, [period, customStart, customEnd]);

  const dateInput = { startDate: dateRange.startDate, endDate: dateRange.endDate };

  // Queries — all date-filtered
  const { data: profitLoss, isLoading: plLoading } = api.dashboard.profitLoss.useQuery(dateInput);
  const { data: categorySpend, isLoading: catLoading } = api.categories.spending.useQuery(dateInput);
  const { data: incomeByCategory, isLoading: incomeLoading } = api.categories.spending.useQuery({
    ...dateInput,
    type: 'INCOME',
  });
  const { data: entitySpend, isLoading: entityLoading } = api.entities.spendingSummary.useQuery(dateInput);
  const { data: cashflow, isLoading: cashflowLoading } = api.dashboard.cashflow.useQuery({
    ...dateInput,
    period: 'monthly',
  });
  const { data: vendorData, isLoading: vendorLoading } = api.vendors.list.useQuery({
    sortBy: 'spending',
    sortOrder: 'desc',
    limit: 10,
  });

  const cashflowTotals = useMemo(() => {
    if (!cashflow || cashflow.length === 0) {
      return { income: 0, expenses: 0, net: 0 };
    }

    return cashflow.reduce(
      (totals, row) => {
        totals.income += row.income;
        totals.expenses += row.expenses;
        totals.net += row.net;
        return totals;
      },
      { income: 0, expenses: 0, net: 0 }
    );
  }, [cashflow]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        {/* Date Range Selector */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Reports</h1>
          <DateRangeSelector
            value={period}
            onChange={setPeriod}
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
            <TabsTrigger value="entities">By Entity</TabsTrigger>
            <TabsTrigger value="top-vendors">Top Vendors</TabsTrigger>
          </TabsList>

          {/* P&L Tab */}
          <TabsContent value="pnl" className="mt-6">
            {plLoading ? (
              <Skeleton className="h-96" />
            ) : profitLoss ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Profit & Loss Summary</CardTitle>
                    <CardDescription>{dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Revenue</span>
                        <span className="text-income font-bold">
                          {formatCurrency(profitLoss.revenue)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-muted-foreground">Cost of Goods Sold</span>
                        <span className="text-expense">
                          ({formatCurrency(profitLoss.cogs)})
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b bg-muted/50 px-2 rounded">
                        <span className="font-semibold">Gross Profit</span>
                        <div className="text-right">
                          <span className="font-bold">
                            {formatCurrency(profitLoss.grossProfit)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({profitLoss.grossMargin.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-muted-foreground">Operating Expenses</span>
                        <span className="text-expense">
                          ({formatCurrency(profitLoss.operatingExpenses)})
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b bg-muted/50 px-2 rounded">
                        <span className="font-semibold">Operating Income</span>
                        <div className="text-right">
                          <span
                            className={cn(
                              'font-bold',
                              profitLoss.operatingIncome >= 0
                                ? 'text-income'
                                : 'text-expense'
                            )}
                          >
                            {formatCurrency(profitLoss.operatingIncome)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({profitLoss.operatingMargin.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-muted-foreground">Personal / Owner Draws</span>
                        <span className="text-expense">
                          ({formatCurrency(profitLoss.personalExpenses)})
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 bg-primary/10 px-2 rounded">
                        <span className="font-bold text-lg">Net Income</span>
                        <div className="text-right">
                          <span
                            className={cn(
                              'font-bold text-lg',
                              profitLoss.netIncome >= 0
                                ? 'text-income'
                                : 'text-expense'
                            )}
                          >
                            {formatCurrency(profitLoss.netIncome)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({profitLoss.netMargin.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Expense Breakdown Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>Expense Breakdown</CardTitle>
                    <CardDescription>By classification</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={[
                          { name: 'COGS', value: profitLoss.cogs },
                          { name: 'Operating', value: profitLoss.operatingExpenses },
                          { name: 'Personal', value: profitLoss.personalExpenses },
                        ]}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                        <YAxis type="category" dataKey="name" width={80} />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Financial Health Metrics */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Financial Health</CardTitle>
                    <CardDescription>Key ratios and metrics — {dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border p-4">
                        <p className="text-xs text-muted-foreground">Gross Margin</p>
                        <p className={cn('text-2xl font-bold', profitLoss.grossMargin >= 0 ? 'text-foreground' : 'text-expense')}>
                          {profitLoss.grossMargin.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Revenue after COGS</p>
                      </div>
                      <div className="rounded-lg border p-4">
                        <p className="text-xs text-muted-foreground">Operating Margin</p>
                        <p className={cn('text-2xl font-bold', profitLoss.operatingMargin >= 0 ? 'text-foreground' : 'text-expense')}>
                          {profitLoss.operatingMargin.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Revenue after COGS + OpEx</p>
                      </div>
                      <div className="rounded-lg border p-4">
                        <p className="text-xs text-muted-foreground">Net Margin</p>
                        <p className={cn('text-2xl font-bold', profitLoss.netMargin >= 0 ? 'text-foreground' : 'text-expense')}>
                          {profitLoss.netMargin.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Revenue after all expenses</p>
                      </div>
                      <div className="rounded-lg border p-4">
                        <p className="text-xs text-muted-foreground">Savings Rate</p>
                        <p className={cn('text-2xl font-bold', profitLoss.savingsRate >= 0 ? 'text-income' : 'text-expense')}>
                          {profitLoss.savingsRate.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Income retained</p>
                      </div>
                    </div>
                    {profitLoss.revenue > 0 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/50">
                          <span className="text-sm text-muted-foreground">COGS Ratio</span>
                          <span className="font-medium">{(profitLoss.cogs / profitLoss.revenue * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center py-2 px-3 rounded bg-muted/50">
                          <span className="text-sm text-muted-foreground">OpEx Ratio</span>
                          <span className="font-medium">{(profitLoss.operatingExpenses / profitLoss.revenue * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Category Breakdown for P&L */}
                {profitLoss.byCategory.length > 0 && (
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>By Category</CardTitle>
                      <CardDescription>
                        Breakdown of all transactions by category and classification
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {profitLoss.byCategory.map((cat) => (
                          <div key={cat.categoryId} className="flex items-center gap-3">
                            <span
                              className={cn(
                                'text-xs font-medium px-2 py-0.5 rounded border',
                                CLASSIFICATION_STYLES[cat.classification] ?? 'bg-slate-50 text-slate-700 border-slate-200'
                              )}
                            >
                              {cat.classification}
                            </span>
                            <span className="flex-1 font-medium">{cat.name}</span>
                            <span className="font-bold">{formatCurrency(cat.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No P&L data available
              </div>
            )}
          </TabsContent>

          {/* Income vs Expense Tab */}
          <TabsContent value="income-vs-expense" className="mt-6">
            {cashflowLoading ? (
              <Skeleton className="h-96" />
            ) : cashflow && cashflow.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Income vs Expenses</CardTitle>
                  <CardDescription>Monthly comparison — {dateRange.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={cashflow}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => {
                          const [year, month] = v.split('-');
                          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          return `${months[parseInt(month, 10) - 1]} ${year.slice(2)}`;
                        }}
                      />
                      <YAxis tickFormatter={(v) => `$${Math.abs(v)}`} />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          formatCurrency(value),
                          name,
                        ]}
                      />
                      <Legend />
                      <Bar dataKey="income" name="Income" fill={CHART_COLORS.income} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" name="Expenses" fill={CHART_COLORS.expense} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-muted-foreground">Total Income</p>
                      <p className="text-xl font-bold text-income">
                        {formatCurrency(cashflowTotals.income)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-muted-foreground">Total Expenses</p>
                      <p className="text-xl font-bold text-expense">
                        {formatCurrency(cashflowTotals.expenses)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-muted-foreground">Net Total</p>
                      <p
                        className={cn(
                          'text-xl font-bold',
                          cashflowTotals.net >= 0 ? 'text-income' : 'text-expense'
                        )}
                      >
                        {formatCurrency(cashflowTotals.net)}
                      </p>
                    </div>
                  </div>

                  {/* Summary table below chart */}
                  <div className="mt-6 border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Period</th>
                          <th className="text-right p-3 font-medium text-income">Income</th>
                          <th className="text-right p-3 font-medium text-expense">Expenses</th>
                          <th className="text-right p-3 font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashflow.map((row) => (
                          <tr key={row.date} className="border-b last:border-0">
                            <td className="p-3 font-medium">{row.date}</td>
                            <td className="p-3 text-right text-income">
                              {formatCurrency(row.income)}
                            </td>
                            <td className="p-3 text-right text-expense">
                              {formatCurrency(row.expenses)}
                            </td>
                            <td
                              className={cn(
                                'p-3 text-right font-bold',
                                row.net >= 0 ? 'text-income' : 'text-expense'
                              )}
                            >
                              {formatCurrency(row.net)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/50 font-semibold">
                          <td className="p-3">Total</td>
                          <td className="p-3 text-right text-income">
                            {formatCurrency(cashflowTotals.income)}
                          </td>
                          <td className="p-3 text-right text-expense">
                            {formatCurrency(cashflowTotals.expenses)}
                          </td>
                          <td
                            className={cn(
                              'p-3 text-right',
                              cashflowTotals.net >= 0 ? 'text-income' : 'text-expense'
                            )}
                          >
                            {formatCurrency(cashflowTotals.net)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No cashflow data available for this period
              </div>
            )}
          </TabsContent>

          {/* Expense Categories Tab */}
          <TabsContent value="categories" className="mt-6">
            {catLoading ? (
              <Skeleton className="h-96" />
            ) : categorySpend && categorySpend.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Expense Distribution</CardTitle>
                    <CardDescription>{dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={categorySpend.slice(0, 8)}
                          dataKey="amount"
                          nameKey="categoryName"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ categoryName, percentOfTotal }) =>
                            `${categoryName}: ${percentOfTotal.toFixed(0)}%`
                          }
                        >
                          {categorySpend.slice(0, 8).map((_, index) => (
                            <Cell key={index} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Top Expense Categories</CardTitle>
                    <CardDescription>{dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {categorySpend.map((cat, i) => (
                        <div key={cat.categoryId} className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }}
                          />
                          <span className="text-lg">{cat.icon}</span>
                          <span className="flex-1 font-medium">{cat.categoryName}</span>
                          <span className="text-muted-foreground text-sm">
                            {cat.transactionCount} txn
                          </span>
                          <span className="font-bold">{formatCurrency(cat.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No expense category data available
              </div>
            )}
          </TabsContent>

          {/* Income Sources Tab */}
          <TabsContent value="income-sources" className="mt-6">
            {incomeLoading ? (
              <Skeleton className="h-96" />
            ) : incomeByCategory && incomeByCategory.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Income Distribution</CardTitle>
                    <CardDescription>{dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={incomeByCategory.slice(0, 8)}
                          dataKey="amount"
                          nameKey="categoryName"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ categoryName, percentOfTotal }) =>
                            `${categoryName}: ${percentOfTotal.toFixed(0)}%`
                          }
                        >
                          {incomeByCategory.slice(0, 8).map((_, index) => (
                            <Cell key={index} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Income by Category</CardTitle>
                    <CardDescription>{dateRange.label}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {incomeByCategory.map((cat, i) => (
                        <div key={cat.categoryId} className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }}
                          />
                          <span className="text-lg">{cat.icon}</span>
                          <span className="flex-1 font-medium">{cat.categoryName}</span>
                          <span className="text-muted-foreground text-sm">
                            {cat.transactionCount} txn
                          </span>
                          <span className="font-bold text-income">
                            {formatCurrency(cat.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No income data available for this period
              </div>
            )}
          </TabsContent>

          {/* Entities Tab */}
          <TabsContent value="entities" className="mt-6">
            {entityLoading ? (
              <Skeleton className="h-96" />
            ) : entitySpend && entitySpend.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Spending by Entity</CardTitle>
                  <CardDescription>
                    Personal vs Business expense breakdown — {dateRange.label}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={entitySpend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Bar
                        dataKey="totalSpend"
                        name="Total Spend"
                        fill={CHART_COLORS.primary}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    {entitySpend.map((entity) => (
                      <Card key={entity.id}>
                        <CardContent className="pt-4">
                          <p className="font-medium">{entity.name}</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            {entity.type}
                          </p>
                          <p className="text-2xl font-bold">
                            {formatCurrency(entity.totalSpend)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entity.transactionCount} transactions
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No entity data available
              </div>
            )}
          </TabsContent>

          {/* Top Vendors Tab */}
          <TabsContent value="top-vendors" className="mt-6">
            {vendorLoading ? (
              <Skeleton className="h-96" />
            ) : vendorData && vendorData.vendors.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Top Vendors by Spending</CardTitle>
                    <CardDescription>Top 10 vendors across all time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart
                        data={vendorData.vendors}
                        layout="vertical"
                        margin={{ left: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={120}
                          tick={{ fontSize: 12 }}
                        />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar
                          dataKey="totalSpending"
                          name="Total Spending"
                          fill={CHART_COLORS.purple}
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Vendor Details</CardTitle>
                    <CardDescription>
                      {vendorData.total} vendors total
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {vendorData.vendors.map((vendor, i) => (
                        <div key={vendor.name} className="flex items-center gap-3">
                          <span className="text-sm font-bold text-muted-foreground w-6">
                            {i + 1}.
                          </span>
                          <span className="flex-1 font-medium">{vendor.name}</span>
                          <span className="text-muted-foreground text-sm">
                            {vendor.count} txn
                          </span>
                          <span className="font-bold">
                            {formatCurrency(vendor.totalSpending)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No vendor data available
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
