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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, cn } from '@/lib/utils';
import { Landmark, Users, ReceiptText, ArrowDownUp } from 'lucide-react';

function yearOptions(): number[] {
  const current = new Date().getFullYear();
  return [current, current - 1, current - 2];
}

const MONTH_LABELS: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

export function TaxView() {
  const [year, setYear] = useState(new Date().getFullYear());
  const input = { year };

  const { data: scheduleC, isLoading: scLoading } = api.tax.scheduleC.useQuery(input);
  const { data: salesTax, isLoading: taxLoading } = api.tax.salesTaxCollected.useQuery(input);
  const { data: equity, isLoading: equityLoading } = api.tax.ownerEquity.useQuery(input);
  const { data: contractors, isLoading: contractorsLoading } =
    api.tax.contractorCandidates.useQuery(input);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Tax</h1>
            <p className="text-sm text-muted-foreground">
              Cash-basis reporting aids for filing season — review with a preparer
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

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Schedule C summary */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ReceiptText className="h-5 w-5 text-primary" />
                <CardTitle>Schedule C Summary — {year}</CardTitle>
              </div>
              <CardDescription>
                Business P&amp;L mapped to Schedule C lines. Personal spending,
                reimbursables, and transfers excluded.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {scLoading || !scheduleC ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Gross receipts (line 1)</span>
                      <span className="font-semibold">{formatCurrency(scheduleC.grossReceipts)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Returns &amp; allowances (line 2)</span>
                      <span className="text-expense">({formatCurrency(scheduleC.returnsAndAllowances)})</span>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span>Net receipts (line 3)</span>
                      <span className="font-semibold">{formatCurrency(scheduleC.netReceipts)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost of goods sold (line 4)</span>
                      <span className="text-expense">({formatCurrency(scheduleC.cogs)})</span>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span>Gross profit (line 5)</span>
                      <span className="font-semibold">{formatCurrency(scheduleC.grossProfit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total expenses (line 28)</span>
                      <span className="text-expense">({formatCurrency(scheduleC.totalExpenses)})</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 font-bold">
                      <span>Tentative profit (line 29)</span>
                      <span className={cn(scheduleC.tentativeProfit >= 0 ? 'text-income' : 'text-expense')}>
                        {formatCurrency(scheduleC.tentativeProfit)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-2">{scheduleC.disclaimer}</p>
                  </div>
                  <div className="border rounded-lg overflow-hidden self-start">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left p-2">Line</th>
                          <th className="text-left p-2">Expense</th>
                          <th className="text-right p-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleC.lines.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="p-4 text-center text-muted-foreground">
                              No business expenses classified for {year}.
                            </td>
                          </tr>
                        ) : (
                          scheduleC.lines.map((l) => (
                            <tr key={l.line} className="border-b last:border-0">
                              <td className="p-2 text-muted-foreground">{l.line}</td>
                              <td className="p-2">
                                <span className="font-medium">{l.label}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {l.categories.join(', ')}
                                </span>
                              </td>
                              <td className="p-2 text-right font-semibold">
                                {formatCurrency(l.amount)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sales tax */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" />
                <CardTitle>Sales Tax Collected</CardTitle>
              </div>
              <CardDescription>
                From Square order tax lines — the amount owed to the state, excluded from
                revenue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {taxLoading || !salesTax ? (
                <Skeleton className="h-32" />
              ) : salesTax.total === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No sales tax collected in {year}. Expected while tax collection isn&apos;t
                  enabled at the POS — once it is, monthly totals appear here automatically.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-2xl font-bold">{formatCurrency(salesTax.total)}</p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {salesTax.months.map((m) => (
                          <tr key={m.month} className="border-b last:border-0">
                            <td className="p-2">{MONTH_LABELS[m.month.slice(5)] ?? m.month}</td>
                            <td className="p-2 text-right font-semibold">
                              {formatCurrency(m.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Owner equity */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ArrowDownUp className="h-5 w-5 text-primary" />
                <CardTitle>Owner Draws &amp; Contributions</CardTitle>
              </div>
              <CardDescription>
                Boundary crossings tagged by transfer reconciliation — equity movement, not
                income or expense.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {equityLoading || !equity ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded border px-3 py-2">
                      <p className="text-xs text-muted-foreground">Draws</p>
                      <p className="font-semibold text-expense">{formatCurrency(equity.draws)}</p>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <p className="text-xs text-muted-foreground">Contributions</p>
                      <p className="font-semibold text-income">
                        {formatCurrency(equity.contributions)}
                      </p>
                    </div>
                    <div className="rounded border px-3 py-2">
                      <p className="text-xs text-muted-foreground">Net</p>
                      <p className={cn('font-semibold', equity.net >= 0 ? 'text-income' : 'text-expense')}>
                        {formatCurrency(equity.net)}
                      </p>
                    </div>
                  </div>
                  {equity.entries.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No tagged owner draws or contributions in {year}. Run transfer
                      reconciliation (Review → Transfers) to tag boundary crossings.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 1099 candidates */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle>1099-NEC Candidates</CardTitle>
              </div>
              <CardDescription>
                Business payees paid ${contractors?.threshold ?? 600}+ in {year}. Whether a
                payee is reportable (unincorporated, services) is your call — this is the
                list to check.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {contractorsLoading || !contractors ? (
                <Skeleton className="h-40" />
              ) : contractors.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No business payees over the threshold in {year}.
                </p>
              ) : (
                <div className="border rounded-lg overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left p-2">Payee</th>
                        <th className="text-right p-2">Payments</th>
                        <th className="text-left p-2">Channels</th>
                        <th className="text-right p-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractors.candidates.map((c) => (
                        <tr key={c.payee} className="border-b last:border-0">
                          <td className="p-2 font-medium">{c.payee}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {c.paymentCount}
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">
                            {c.channels.join(', ')}
                          </td>
                          <td className="p-2 text-right font-semibold">
                            {formatCurrency(c.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
