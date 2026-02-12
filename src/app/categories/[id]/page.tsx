'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/trpc';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select-native';
import { useToastCallbacks } from '@/hooks/use-toast-mutation';
import { formatCurrency, formatDate, transactionTypeColor } from '@/lib/utils';
import { ArrowLeft, Plus } from 'lucide-react';

type ClassificationType =
  | 'INCOME'
  | 'COGS'
  | 'OPERATING'
  | 'PERSONAL'
  | 'TRANSFER'
  | 'REIMBURSABLE'
  | 'REIMBURSEMENT';

export default function CategoryDetailPage() {
  const params = useParams<{ id: string }>();
  const categoryId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [newSubcategoryIcon, setNewSubcategoryIcon] = useState('');

  const utils = api.useUtils();

  const { data: category, isLoading: categoryLoading } = api.categories.getById.useQuery(
    { id: categoryId ?? '' },
    { enabled: !!categoryId }
  );

  const { data: subcategories, isLoading: subcategoriesLoading } = api.categories.list.useQuery(
    { parentId: categoryId ?? null },
    { enabled: !!categoryId }
  );

  const { data: txData, isLoading: txLoading } = api.transactions.list.useQuery(
    {
      categoryId: categoryId ?? undefined,
      page,
      limit: 50,
      search: search.trim() || undefined,
    },
    { enabled: !!categoryId }
  );

  const bulkCategorize = api.transactions.bulkCategorize.useMutation(
    useToastCallbacks({
      successTitle: 'Subcategory Assignment Complete',
      successDescription: 'Transactions were reassigned to the selected subcategory.',
      errorTitle: 'Failed to assign subcategory',
    })
  );

  const createSubcategory = api.categories.create.useMutation(
    useToastCallbacks({
      successTitle: 'Subcategory Created',
      successDescription: 'New subcategory is ready to use.',
      errorTitle: 'Failed to create subcategory',
    })
  );

  const transactions = txData?.data ?? [];
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allOnPageSelected =
    transactions.length > 0 && transactions.every((tx) => selectedSet.has(tx.id));

  const refreshData = async () => {
    await Promise.all([
      utils.transactions.list.invalidate(),
      utils.categories.list.invalidate(),
      utils.categories.tree.invalidate(),
      utils.categories.getById.invalidate(),
      utils.dashboard.invalidate(),
    ]);
  };

  const handleToggleAllOnPage = (checked: boolean) => {
    if (!checked) {
      const pageIds = new Set(transactions.map((tx) => tx.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)));
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const tx of transactions) next.add(tx.id);
      return Array.from(next);
    });
  };

  const handleToggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((value) => value !== id);
    });
  };

  const handleAssignToSubcategory = async () => {
    if (!selectedSubcategory || selectedIds.length === 0) return;
    await bulkCategorize.mutateAsync({
      transactionIds: selectedIds,
      categoryId: selectedSubcategory,
    });
    setSelectedIds([]);
    setSelectedSubcategory('');
    await refreshData();
  };

  const handleCreateSubcategory = async () => {
    if (!categoryId || !newSubcategoryName.trim()) return;

    await createSubcategory.mutateAsync({
      name: newSubcategoryName.trim(),
      icon: newSubcategoryIcon.trim() || undefined,
      parentId: categoryId,
      color: category?.color || undefined,
      defaultClassification: (category?.defaultClassification as ClassificationType | null) || undefined,
    });

    setNewSubcategoryName('');
    setNewSubcategoryIcon('');
    await refreshData();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/categories">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Categories
              </Link>
            </Button>
            <h1 className="text-2xl font-bold">
              {categoryLoading ? 'Loading category...' : category?.name || 'Category'}
            </h1>
            <p className="text-muted-foreground">
              Assign transactions in this category into subcategories.
            </p>
          </div>
          {category?.defaultClassification && (
            <Badge variant="outline">{category.defaultClassification}</Badge>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Subcategories</CardTitle>
            <CardDescription>
              {(subcategories?.length ?? 0)} subcategories for this category
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="New subcategory name"
                value={newSubcategoryName}
                onChange={(e) => setNewSubcategoryName(e.target.value)}
              />
              <Input
                placeholder="Icon (optional)"
                value={newSubcategoryIcon}
                onChange={(e) => setNewSubcategoryIcon(e.target.value)}
                className="max-w-[160px]"
              />
              <Button
                onClick={handleCreateSubcategory}
                disabled={!newSubcategoryName.trim() || createSubcategory.isLoading}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            {subcategoriesLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (subcategories?.length ?? 0) > 0 ? (
              <div className="flex flex-wrap gap-2">
                {subcategories?.map((sub) => (
                  <Badge key={sub.id} variant="secondary">
                    {sub.icon ? `${sub.icon} ` : ''}{sub.name} ({sub._count.transactions})
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No subcategories yet. Create one above to start splitting this category.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category Transactions</CardTitle>
            <CardDescription>
              {txData?.pagination.total ?? 0} transaction
              {(txData?.pagination.total ?? 0) === 1 ? '' : 's'} currently assigned here
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                placeholder="Search transactions"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              <Select
                value={selectedSubcategory}
                onChange={(e) => setSelectedSubcategory(e.target.value)}
              >
                <option value="">Choose subcategory</option>
                {subcategories?.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.icon ? `${sub.icon} ` : ''}{sub.name}
                  </option>
                ))}
              </Select>
              <Button
                onClick={handleAssignToSubcategory}
                disabled={
                  !selectedSubcategory ||
                  selectedIds.length === 0 ||
                  bulkCategorize.isLoading
                }
              >
                Assign {selectedIds.length > 0 ? `(${selectedIds.length})` : ''} to Subcategory
              </Button>
            </div>

            {txLoading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No transactions found for this category and filter.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between border rounded-md px-3 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={(e) => handleToggleAllOnPage(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    Select all on this page
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds([])}
                    disabled={selectedIds.length === 0}
                  >
                    Clear selection
                  </Button>
                </div>

                <div className="divide-y border rounded-md">
                  {transactions.map((tx) => {
                    const amount = Number(tx.amount);
                    const sign = tx.type === 'INCOME' ? '+' : tx.type === 'EXPENSE' ? '-' : '';
                    return (
                      <div key={tx.id} className="flex items-center gap-3 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(tx.id)}
                          onChange={(e) => handleToggleOne(tx.id, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">
                            {tx.merchantName || tx.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(tx.date)} • {tx.account?.name || 'Unknown account'}
                          </p>
                        </div>
                        <Badge variant="outline">{tx.type}</Badge>
                        <p className={`font-semibold ${transactionTypeColor(tx.type)}`}>
                          {sign}{formatCurrency(amount)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {txData && txData.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-sm text-muted-foreground">
                      Page {txData.pagination.page} of {txData.pagination.totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= txData.pagination.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
