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
  };
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      title: 'Total Balance',
      value: formatCurrency(stats.totalBalance),
      icon: Wallet,
      description: 'Across all accounts',
      trend: null,
      className: 'text-primary',
    },
    {
      title: 'Monthly Income',
      value: formatCurrency(stats.monthlyIncome),
      icon: TrendingUp,
      description: 'This month',
      trend: '+12.5%',
      trendUp: true,
      className: 'text-green-600',
    },
    {
      title: 'Monthly Expenses',
      value: formatCurrency(stats.monthlyExpenses),
      icon: TrendingDown,
      description: 'This month',
      trend: '+3.2%',
      trendUp: false,
      className: 'text-red-600',
    },
    {
      title: 'Net Cashflow',
      value: formatCurrency(stats.monthlyNet),
      icon: Activity,
      description: 'This month',
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
