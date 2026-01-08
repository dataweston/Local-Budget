'use client';

import Link from 'next/link';
import { AlertCircle, Receipt, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AlertsPanelProps {
  pendingReceipts: number;
  unreviewedTransactions: number;
}

export function AlertsPanel({
  pendingReceipts,
  unreviewedTransactions,
}: AlertsPanelProps) {
  const alerts = [
    {
      id: 'receipts',
      show: pendingReceipts > 0,
      icon: Receipt,
      title: `${pendingReceipts} pending receipt${pendingReceipts > 1 ? 's' : ''}`,
      description: 'Waiting to be processed or matched',
      action: 'Review',
      href: '/receipts',
      variant: 'warning' as const,
    },
    {
      id: 'transactions',
      show: unreviewedTransactions > 0,
      icon: AlertCircle,
      title: `${unreviewedTransactions} unreviewed transaction${unreviewedTransactions > 1 ? 's' : ''}`,
      description: 'Need categorization or review',
      action: 'Review',
      href: '/transactions',
      variant: 'info' as const,
    },
  ].filter((alert) => alert.show);

  if (alerts.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-yellow-500">
      <CardContent className="py-4">
        <div className="flex flex-wrap gap-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'flex items-center gap-3 flex-1 min-w-[250px] p-3 rounded-lg',
                alert.variant === 'warning'
                  ? 'bg-yellow-50 dark:bg-yellow-950'
                  : 'bg-blue-50 dark:bg-blue-950'
              )}
            >
              <alert.icon
                className={cn(
                  'h-5 w-5',
                  alert.variant === 'warning'
                    ? 'text-yellow-600'
                    : 'text-blue-600'
                )}
              />
              <div className="flex-1">
                <p className="font-medium text-sm">{alert.title}</p>
                <p className="text-xs text-muted-foreground">
                  {alert.description}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={alert.href}>{alert.action}</Link>
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
