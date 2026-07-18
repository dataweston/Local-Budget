'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate, cn, classificationColor } from '@/lib/utils';
import { useToastCallbacks } from '@/hooks/use-toast-mutation';
import { AddTransactionModal } from './AddTransactionModal';
import { SplitTransactionModal } from './SplitTransactionModal';
import { LinkTransactionModal } from './LinkTransactionModal';
import { RevenueRecoveryPanel } from './RevenueRecoveryPanel';
import { UploadReceiptModal } from '@/components/receipts/UploadReceiptModal';
import {
  Search,
  Filter,
  Download,
  Plus,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Upload,
  Scissors,
  Link2,
  ArrowRight,
} from 'lucide-react';

interface SelectedTransaction {
  id: string;
  description: string;
  merchantName?: string | null;
  amount: any;
  type: string;
  date: any;
  account?: { name: string } | null;
  categoryId?: string | null;
  category?: { name: string; icon: string | null } | null;
  classification?: string | null;
  isReviewed: boolean;
}

interface Filters {
  accountId?: string;
  categoryId?: string;
  classification?: string;
  type?: string;
  isReviewed?: boolean;
  startDate?: string;
  endDate?: string;
}

function exportToCsv(transactions: any[]) {
  const headers = ['Date', 'Description', 'Merchant', 'Account', 'Category', 'Classification', 'Amount', 'Type', 'Reviewed'];
  const rows = transactions.map((tx) => [
    new Date(tx.date).toLocaleDateString(),
    `"${(tx.description || '').replace(/"/g, '""')}"`,
    `"${(tx.merchantName || '').replace(/"/g, '""')}"`,
    tx.account?.name || '',
    tx.category?.name || 'Uncategorized',
    tx.classification || '',
    Number(tx.amount).toFixed(2),
    tx.type,
    tx.isReviewed ? 'Yes' : 'No',
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TransactionsList() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearch);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTx, setSelectedTx] = useState<SelectedTransaction | null>(null);
  const [splitTxId, setSplitTxId] = useState<string | null>(null);
  const [splitTxAmount, setSplitTxAmount] = useState(0);
  const [linkTxId, setLinkTxId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, filters]);

  const queryInput = {
    page,
    limit: 20,
    search: search || undefined,
    accountId: filters.accountId || undefined,
    categoryId: filters.categoryId || undefined,
    classification: filters.classification as any || undefined,
    type: filters.type as any || undefined,
    isReviewed: filters.isReviewed,
    startDate: filters.startDate ? new Date(filters.startDate) : undefined,
    endDate: filters.endDate ? new Date(filters.endDate) : undefined,
  };

  const { data, isLoading } = api.transactions.list.useQuery(queryInput);
  const { data: accounts } = api.accounts.list.useQuery();
  const { data: categories } = api.categories.list.useQuery();

  const utils = api.useUtils();
  const updateCategory = api.transactions.update.useMutation(
    useToastCallbacks({
      successTitle: 'Category Updated',
      successDescription: 'Transaction category has been updated',
      errorTitle: 'Failed to update category',
    })
  );

  const handleCategoryChange = async (transactionId: string, value: string) => {
    await updateCategory.mutateAsync({
      id: transactionId,
      data: { categoryId: value === '_uncategorized' ? null : value },
    });
    await utils.transactions.list.invalidate();
    await utils.dashboard.invalidate();
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined && v !== '');

  function clearFilters() {
    setFilters({});
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <AddTransactionModal open={showAddModal} onOpenChange={setShowAddModal} />

      {/* Split Transaction Modal */}
      {splitTxId && (
        <SplitTransactionModal
          open={!!splitTxId}
          onOpenChange={(open) => !open && setSplitTxId(null)}
          transactionId={splitTxId}
          transactionAmount={splitTxAmount}
        />
      )}

      {/* Link Transaction Modal */}
      {linkTxId && (
        <LinkTransactionModal
          open={!!linkTxId}
          onOpenChange={(open) => !open && setLinkTxId(null)}
          transactionId={linkTxId}
        />
      )}

      {/* Transaction Detail Dialog */}
      <TransactionDetailDialog
        transaction={selectedTx}
        categories={categories}
        onCategoryChange={handleCategoryChange}
        onClose={() => setSelectedTx(null)}
        onSplit={(id, amount) => { setSelectedTx(null); setSplitTxId(id); setSplitTxAmount(amount); }}
        onLink={(id) => { setSelectedTx(null); setLinkTxId(id); }}
      />

      <main className="flex-1 container mx-auto px-4 py-6">
        <RevenueRecoveryPanel />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>
                {data?.pagination.total ?? 0} total transactions
                {hasActiveFilters && ' (filtered)'}
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
              <Button
                variant={showFilters ? 'default' : 'outline'}
                size="icon"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => data?.data && exportToCsv(data.data)}
                disabled={!data?.data?.length}
                title="Export to CSV"
              >
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

          {/* Filter Panel */}
          {showFilters && (
            <div className="px-6 pb-4 border-b">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Account</label>
                  <Select
                    value={filters.accountId || '_all'}
                    onValueChange={(v) => setFilters((f) => ({ ...f, accountId: v === '_all' ? undefined : v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All accounts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All accounts</SelectItem>
                      {accounts?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
                  <Select
                    value={filters.categoryId || '_all'}
                    onValueChange={(v) => setFilters((f) => ({ ...f, categoryId: v === '_all' ? undefined : v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All categories</SelectItem>
                      {categories?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Classification</label>
                  <Select
                    value={filters.classification || '_all'}
                    onValueChange={(v) => setFilters((f) => ({ ...f, classification: v === '_all' ? undefined : v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All</SelectItem>
                      <SelectItem value="INCOME">Income</SelectItem>
                      <SelectItem value="COGS">COGS</SelectItem>
                      <SelectItem value="OPERATING">Operating</SelectItem>
                      <SelectItem value="PERSONAL">Personal</SelectItem>
                      <SelectItem value="TRANSFER">Transfer</SelectItem>
                      <SelectItem value="REIMBURSABLE">Reimbursable</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                  <Select
                    value={filters.type || '_all'}
                    onValueChange={(v) => setFilters((f) => ({ ...f, type: v === '_all' ? undefined : v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All types</SelectItem>
                      <SelectItem value="INCOME">Income</SelectItem>
                      <SelectItem value="EXPENSE">Expense</SelectItem>
                      <SelectItem value="TRANSFER">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Reviewed</label>
                  <Select
                    value={filters.isReviewed === undefined ? '_all' : String(filters.isReviewed)}
                    onValueChange={(v) => setFilters((f) => ({ ...f, isReviewed: v === '_all' ? undefined : v === 'true' }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All</SelectItem>
                      <SelectItem value="true">Reviewed</SelectItem>
                      <SelectItem value="false">Unreviewed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end">
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Start Date</label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.startDate || ''}
                    onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value || undefined }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">End Date</label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.endDate || ''}
                    onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value || undefined }))}
                  />
                </div>
              </div>
            </div>
          )}

          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(10)].map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : data?.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p className="text-lg font-medium">No transactions found</p>
                <p className="text-sm">
                  {hasActiveFilters || search
                    ? 'Try adjusting your filters or search terms'
                    : 'Add your first transaction to get started'}
                </p>
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
                    const isIncome = tx.type === 'INCOME';

                    return (
                      <div
                        key={tx.id}
                        className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-accent/50 cursor-pointer"
                        onClick={() => setSelectedTx(tx as SelectedTransaction)}
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
                        <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={tx.categoryId ?? '_uncategorized'}
                            onValueChange={(v) => handleCategoryChange(tx.id, v)}
                          >
                            <SelectTrigger className="h-8 text-sm border-none bg-transparent px-2 shadow-none hover:bg-accent focus:ring-1">
                              <SelectValue>
                                {tx.category ? (
                                  <span className="flex items-center gap-1">
                                    <span>{tx.category.icon}</span>
                                    <span>{tx.category.name}</span>
                                  </span>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    Uncategorized
                                  </Badge>
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_uncategorized">Uncategorized</SelectItem>
                              {categories?.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.icon} {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                          {isIncome ? '+' : '-'}
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

function TransactionDetailDialog({
  transaction,
  categories,
  onCategoryChange,
  onClose,
  onSplit,
  onLink,
}: {
  transaction: SelectedTransaction | null;
  categories?: { id: string; name: string; icon: string | null }[];
  onCategoryChange: (transactionId: string, value: string) => void | Promise<void>;
  onClose: () => void;
  onSplit: (id: string, amount: number) => void;
  onLink: (id: string) => void;
}) {
  // Fetch splits and links when a transaction is selected
  const { data: splitsData } = api.splits.getByTransactionId.useQuery(
    { transactionId: transaction?.id ?? '' },
    { enabled: !!transaction }
  );

  const { data: linksData } = api.transactionLinks.getByTransactionId.useQuery(
    { transactionId: transaction?.id ?? '' },
    { enabled: !!transaction }
  );

  const allLinks = [
    ...(linksData?.outgoing?.map((l) => ({
      id: l.id,
      type: l.linkType,
      direction: 'outgoing' as const,
      notes: l.notes,
      transaction: l.toTransaction,
    })) ?? []),
    ...(linksData?.incoming?.map((l) => ({
      id: l.id,
      type: l.linkType,
      direction: 'incoming' as const,
      notes: l.notes,
      transaction: l.fromTransaction,
    })) ?? []),
  ];

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>{transaction?.merchantName || transaction?.description}</DialogTitle>
          <DialogDescription>Transaction Details</DialogDescription>
        </DialogHeader>
        {transaction && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className={cn(
                  "text-lg font-bold",
                  transaction.type === 'INCOME' ? 'text-green-600' : 'text-red-600'
                )}>
                  {formatCurrency(Number(transaction.amount))}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-medium">{formatDate(transaction.date)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Account</p>
                <p className="font-medium">{transaction.account?.name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Category</p>
                <Select
                  value={transaction.categoryId ?? '_uncategorized'}
                  onValueChange={(v) => onCategoryChange(transaction.id, v)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue>
                      {transaction.category
                        ? `${transaction.category.icon || ''} ${transaction.category.name}`
                        : 'Uncategorized'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_uncategorized">Uncategorized</SelectItem>
                    {categories?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {transaction.classification && (
                <div>
                  <p className="text-sm text-muted-foreground">Classification</p>
                  <Badge className={classificationColor(transaction.classification)}>
                    {transaction.classification}
                  </Badge>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="font-medium flex items-center gap-1">
                  {transaction.isReviewed ? (
                    <><Check className="h-4 w-4 text-green-600" /> Reviewed</>
                  ) : (
                    <><X className="h-4 w-4 text-muted-foreground" /> Not Reviewed</>
                  )}
                </p>
              </div>
            </div>

            {transaction.description && transaction.description !== transaction.merchantName && (
              <div>
                <p className="text-sm text-muted-foreground">Description</p>
                <p className="font-medium">{transaction.description}</p>
              </div>
            )}

            {/* Splits Section */}
            {splitsData && splitsData.splits.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Scissors className="h-3 w-3" /> Splits
                </p>
                <div className="space-y-1 bg-muted rounded-md p-3">
                  {splitsData.splits.map((split) => (
                    <div key={split.id} className="flex items-center justify-between text-sm">
                      <span>
                        {split.category ? `${split.category.icon || ''} ${split.category.name}` : split.description || 'Uncategorized'}
                      </span>
                      <span className="font-medium">{formatCurrency(Number(split.amount))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Links Section */}
            {allLinks.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Link2 className="h-3 w-3" /> Linked Transactions
                </p>
                <div className="space-y-2">
                  {allLinks.map((link) => (
                    <div key={link.id} className="flex items-center gap-2 bg-muted rounded-md p-3 text-sm">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {link.type}
                      </Badge>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">
                        {link.transaction.description || link.transaction.merchantName}
                      </span>
                      <span className="font-medium shrink-0">
                        {formatCurrency(Number(link.transaction.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSplit(transaction.id, Number(transaction.amount))}
              >
                <Scissors className="h-4 w-4 mr-2" />
                {splitsData && splitsData.splits.length > 0 ? 'Edit Splits' : 'Split'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onLink(transaction.id)}
              >
                <Link2 className="h-4 w-4 mr-2" />
                Link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
