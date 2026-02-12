'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { formatCurrency, cn } from '@/lib/utils';
import { CATEGORY_BAR_COLORS } from '@/lib/colors';

interface CategorySpend {
  categoryId: string | null;
  categoryName: string;
  icon: string | null;
  amount: number;
  transactionCount: number;
  percentOfTotal: number;
}

interface CategoryBreakdownProps {
  categories: CategorySpend[];
  title?: string;
  description?: string;
}

export function CategoryBreakdown({ categories, title, description }: CategoryBreakdownProps) {
  const sortedCategories = [...categories].sort((a, b) => b.amount - a.amount);
  const topCategories = sortedCategories.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? 'Spending by Category'}</CardTitle>
        <CardDescription>{description ?? "This month\u2019s expense breakdown"}</CardDescription>
      </CardHeader>
      <CardContent>
        {topCategories.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No data available
          </div>
        ) : (
          <div className="space-y-4">
            {topCategories.map((category, index) => (
                <div key={category.categoryId ?? 'uncategorized'}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{category.icon}</span>
                      <span className="text-sm font-medium">
                        {category.categoryName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {category.transactionCount} txn
                      </span>
                      <span className="font-semibold text-sm">
                        {formatCurrency(category.amount)}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className={cn('h-2 rounded-full transition-all', CATEGORY_BAR_COLORS[index % CATEGORY_BAR_COLORS.length])}
                      style={{ width: `${Math.min(category.percentOfTotal, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {category.percentOfTotal.toFixed(1)}% of total
                  </div>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
