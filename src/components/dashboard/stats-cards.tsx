'use client';

import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

interface StatsCardsProps {
  stats: {
    totalBalance: number;
    monthlyIncome: number;
    monthlyExpenses: number;
    monthlyNet: number;
    incomeTrend?: number;
    expenseTrend?: number;
  };
  periodLabel?: string;
}

function formatTrend(val: number): string {
  return (val >= 0 ? '+' : '') + val.toFixed(1) + '%';
}

export function StatsCards({ stats, periodLabel }: StatsCardsProps) {
  const label = periodLabel ?? 'This month';

  const cards = [
    {
      title: 'Total Balance',
      value: formatCurrency(stats.totalBalance),
      icon: Wallet,
      description: 'Across all accounts',
      trend: null as string | null,
      trendUp: true,
      className: 'text-primary',
    },
    {
      title: 'Income',
      value: formatCurrency(stats.monthlyIncome),
      icon: TrendingUp,
      description: label,
      trend: stats.incomeTrend != null ? formatTrend(stats.incomeTrend) : null,
      trendUp: (stats.incomeTrend ?? 0) >= 0,
      className: 'text-green-600',
    },
    {
      title: 'Expenses',
      value: formatCurrency(stats.monthlyExpenses),
      icon: TrendingDown,
      description: label,
      trend: stats.expenseTrend != null ? formatTrend(stats.expenseTrend) : null,
      trendUp: (stats.expenseTrend ?? 0) <= 0,
      className: 'text-red-600',
    },
    {
      title: 'Net Cashflow',
      value: formatCurrency(stats.monthlyNet),
      icon: Activity,
      description: label,
      trend: stats.monthlyNet >= 0 ? 'Positive' : 'Negative',
      trendUp: stats.monthlyNet >= 0,
      className: stats.monthlyNet >= 0 ? 'text-green-600' : 'text-red-600',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className={`h-4 w-4 ${card.className}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${card.className}`}>
              {card.value}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {card.description}
              {card.trend && (
                <span
                  className={`ml-2 ${
                    card.trendUp ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {card.trend}
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
