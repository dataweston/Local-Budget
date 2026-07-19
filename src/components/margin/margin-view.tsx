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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, PackageOpen } from 'lucide-react';

function yearOptions(): number[] {
  const current = new Date().getFullYear();
  return [current, current - 1, current - 2];
}

export function MarginView() {
  const [year, setYear] = useState(new Date().getFullYear());

  const range = useMemo(
    () => ({
      startDate: new Date(`${year}-01-01T00:00:00.000Z`),
      endDate: new Date(`${year}-12-31T23:59:59.999Z`),
    }),
    [year]
  );

  const { data: drift, isLoading: driftLoading } = api.margin.priceDrift.useQuery({
    ...range,
    minPoints: 2,
  });
  const { data: sales, isLoading: salesLoading } = api.margin.itemSales.useQuery({
    ...range,
    limit: 100,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Margin</h1>
            <p className="text-sm text-muted-foreground">
              Item-level cost drift and sales performance
            </p>
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions().map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="sales">
          <TabsList>
            <TabsTrigger value="sales">Item Sales</TabsTrigger>
            <TabsTrigger value="drift">Cost Price Drift</TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="mt-6">
            {salesLoading ? (
              <Skeleton className="h-96" />
            ) : !sales || sales.items.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <PackageOpen className="mx-auto mb-3 h-8 w-8" />
                  <p className="font-medium">No sales line items for {year}.</p>
                  <p className="text-sm mt-1">
                    Square order line items appear here after a Square sync.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>What&apos;s selling</CardTitle>
                  <CardDescription>
                    {sales.count} items · {formatCurrency(sales.totalRevenue)} item revenue
                    (net of tax)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left p-2">Item</th>
                          <th className="text-right p-2">Units</th>
                          <th className="text-right p-2">Orders</th>
                          <th className="text-right p-2">Avg Price</th>
                          <th className="text-right p-2">Revenue</th>
                          <th className="text-right p-2">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sales.items.map((row) => (
                          <tr key={row.itemName} className="border-b last:border-0">
                            <td className="p-2 font-medium">{row.itemName}</td>
                            <td className="p-2 text-right text-muted-foreground">
                              {row.unitsSold.toLocaleString()}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">
                              {row.orderCount}
                            </td>
                            <td className="p-2 text-right">{formatCurrency(row.avgPrice)}</td>
                            <td className="p-2 text-right font-semibold">
                              {formatCurrency(row.revenue)}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">
                              {sales.totalRevenue > 0
                                ? ((row.revenue / sales.totalRevenue) * 100).toFixed(1)
                                : '0.0'}
                              %
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="drift" className="mt-6">
            {driftLoading ? (
              <Skeleton className="h-96" />
            ) : !drift || drift.items.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <PackageOpen className="mx-auto mb-3 h-8 w-8" />
                  <p className="font-medium">No cost-side price observations yet.</p>
                  <p className="text-sm mt-1 max-w-md mx-auto">
                    Price drift needs receipt or invoice line items with unit prices. Upload
                    receipts from your top vendors (the OCR extracts quantity, unit, and
                    unit price) and this view lights up.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Unit-price drift</CardTitle>
                  <CardDescription>
                    {drift.count} items with 2+ price observations, biggest movers first
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left p-2">Item</th>
                          <th className="text-left p-2">Vendors</th>
                          <th className="text-right p-2">Obs</th>
                          <th className="text-right p-2">First</th>
                          <th className="text-right p-2">Last</th>
                          <th className="text-right p-2">Range</th>
                          <th className="text-right p-2">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drift.items.map((row) => (
                          <tr
                            key={row.itemId ?? row.itemName}
                            className="border-b last:border-0"
                          >
                            <td className="p-2 font-medium">
                              {row.itemName}
                              {row.unitOfMeasure ? (
                                <span className="text-xs text-muted-foreground ml-1">
                                  / {row.unitOfMeasure}
                                </span>
                              ) : null}
                            </td>
                            <td className="p-2 text-muted-foreground text-xs">
                              {row.vendors.join(', ') || '—'}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">
                              {row.observations}
                            </td>
                            <td className="p-2 text-right">
                              {formatCurrency(row.firstUnitPrice)}
                            </td>
                            <td className="p-2 text-right">
                              {formatCurrency(row.lastUnitPrice)}
                            </td>
                            <td className="p-2 text-right text-muted-foreground">
                              {formatCurrency(row.minUnitPrice)}–
                              {formatCurrency(row.maxUnitPrice)}
                            </td>
                            <td
                              className={cn(
                                'p-2 text-right font-semibold',
                                row.pctChange > 0
                                  ? 'text-expense'
                                  : row.pctChange < 0
                                  ? 'text-income'
                                  : 'text-muted-foreground'
                              )}
                            >
                              <span className="inline-flex items-center gap-1">
                                {row.pctChange > 0 ? (
                                  <TrendingUp className="h-3.5 w-3.5" />
                                ) : row.pctChange < 0 ? (
                                  <TrendingDown className="h-3.5 w-3.5" />
                                ) : null}
                                {row.pctChange > 0 ? '+' : ''}
                                {row.pctChange.toFixed(1)}%
                              </span>
                            </td>
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
