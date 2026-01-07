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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatDate, cn, classificationColor } from '@/lib/utils';
import { AddTransactionModal } from './AddTransactionModal';
import { UploadReceiptModal } from '@/components/receipts/UploadReceiptModal';
import {
  Search,
  Filter,
  Download,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Check,
  X,
  Receipt,
  Upload,
} from 'lucide-react';

export function TransactionsList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data, isLoading } = api.transactions.list.useQuery({
    page,
    limit: 20,
    search: search || undefined,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <AddTransactionModal open={showAddModal} onOpenChange={setShowAddModal} />

      <main className="flex-1 container mx-auto px-4 py-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>
                {data?.pagination.total ?? 0} total transactions
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search..."
                  className="w-64 pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="icon">
                <Filter className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon">
                <Download className="h-4 w-4" />
              </Button>
              <UploadReceiptModal 
                trigger={
                  <Button variant="outline" size="sm">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Receipt
                  </Button>
                }
              />
              <Button size="sm" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Transaction
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(10)].map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-muted-foreground border-b">
                  <div className="col-span-1">Date</div>
                  <div className="col-span-3">Description</div>
                  <div className="col-span-2">Account</div>
                  <div className="col-span-2">Category</div>
                  <div className="col-span-2">Classification</div>
                  <div className="col-span-1 text-right">Amount</div>
                  <div className="col-span-1 text-center">Status</div>
                </div>

                {/* Transactions */}
                <div className="divide-y">
                  {data?.data.map((tx) => {
                    const amount =
                      typeof tx.amount === 'string'
                        ? parseFloat(tx.amount)
                        : Number(tx.amount);
                    const isIncome = tx.type === 'INCOME' || amount > 0;

                    return (
                      <div
                        key={tx.id}
                        className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-accent/50 cursor-pointer"
                      >
                        <div className="col-span-1 text-sm">
                          {formatDate(tx.date, { month: 'short', day: 'numeric' })}
                        </div>
                        <div className="col-span-3">
                          <p className="font-medium text-sm truncate">
                            {tx.merchantName || tx.description}
                          </p>
                          {tx.merchantName && tx.description !== tx.merchantName && (
                            <p className="text-xs text-muted-foreground truncate">
                              {tx.description}
                            </p>
                          )}
                        </div>
                        <div className="col-span-2 text-sm text-muted-foreground">
                          {tx.account?.name}
                        </div>
                        <div className="col-span-2">
                          {tx.category ? (
                            <div className="flex items-center gap-1">
                              <span>{tx.category.icon}</span>
                              <span className="text-sm">{tx.category.name}</span>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              Uncategorized
                            </Badge>
                          )}
                        </div>
                        <div className="col-span-2">
                          {tx.classification && (
                            <Badge
                              className={cn(
                                'text-xs',
                                classificationColor(tx.classification)
                              )}
                            >
                              {tx.classification}
                            </Badge>
                          )}
                        </div>
                        <div
                          className={cn(
                            'col-span-1 text-right font-semibold',
                            isIncome ? 'text-green-600' : 'text-red-600'
                          )}
                        >
                          {isIncome ? '+' : ''}
                          {formatCurrency(amount)}
                        </div>
                        <div className="col-span-1 flex justify-center">
                          {tx.isReviewed ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {data && data.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Page {data.pagination.page} of {data.pagination.totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= data.pagination.totalPages}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
