'use client';

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

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export function ReportsView() {
  const { data: profitLoss, isLoading: plLoading } = api.dashboard.profitLoss.useQuery();
  const { data: categorySpend, isLoading: catLoading } = api.categories.spending.useQuery();
  const { data: entitySpend, isLoading: entityLoading } = api.entities.spendingSummary.useQuery();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        <Tabs defaultValue="pnl">
          <TabsList>
            <TabsTrigger value="pnl">Profit & Loss</TabsTrigger>
            <TabsTrigger value="categories">By Category</TabsTrigger>
            <TabsTrigger value="entities">By Entity</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="mt-6">
            {plLoading ? (
              <Skeleton className="h-96" />
            ) : profitLoss ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* P&L Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle>Profit & Loss Summary</CardTitle>
                    <CardDescription>
                      {new Date(profitLoss.period.start).toLocaleDateString()} -{' '}
                      {new Date(profitLoss.period.end).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Revenue</span>
                        <span className="text-green-600 font-bold">
                          {formatCurrency(profitLoss.revenue)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-muted-foreground">Cost of Goods Sold</span>
                        <span className="text-red-600">
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
                        <span className="text-red-600">
                          ({formatCurrency(profitLoss.operatingExpenses)})
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-3 bg-primary/10 px-2 rounded">
                        <span className="font-bold text-lg">Operating Income</span>
                        <div className="text-right">
                          <span
                            className={cn(
                              'font-bold text-lg',
                              profitLoss.operatingIncome >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            )}
                          >
                            {formatCurrency(profitLoss.operatingIncome)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({profitLoss.operatingMargin.toFixed(1)}%)
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
                        ]}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                        <YAxis type="category" dataKey="name" width={80} />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No P&L data available
              </div>
            )}
          </TabsContent>

          <TabsContent value="categories" className="mt-6">
            {catLoading ? (
              <Skeleton className="h-96" />
            ) : categorySpend && categorySpend.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Pie Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>Spending Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={categorySpend.slice(0, 6)}
                          dataKey="amount"
                          nameKey="categoryName"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ categoryName, percentOfTotal }) =>
                            `${categoryName}: ${percentOfTotal.toFixed(0)}%`
                          }
                        >
                          {categorySpend.slice(0, 6).map((_, index) => (
                            <Cell key={index} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Category List */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top Categories</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {categorySpend.map((cat, i) => (
                        <div key={cat.categoryId} className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          />
                          <span className="text-lg">{cat.icon}</span>
                          <span className="flex-1 font-medium">{cat.categoryName}</span>
                          <span className="text-muted-foreground">
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
                No category data available
              </div>
            )}
          </TabsContent>

          <TabsContent value="entities" className="mt-6">
            {entityLoading ? (
              <Skeleton className="h-96" />
            ) : entitySpend && entitySpend.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Spending by Entity</CardTitle>
                  <CardDescription>
                    Personal vs Business expense breakdown
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
                        fill="#3b82f6"
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
        </Tabs>
      </main>
    </div>
  );
}
