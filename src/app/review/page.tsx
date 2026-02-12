'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/trpc';
import { Header } from '@/components/dashboard/header';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, formatDate, cn, transactionTypeColor } from '@/lib/utils';
import { useToastCallbacks } from '@/hooks/use-toast-mutation';
import {
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  SkipForward,
  Wand2,
  Search,
  Filter,
} from 'lucide-react';

type TransactionTypeFilter = '_all' | 'INCOME' | 'EXPENSE' | 'TRANSFER';
type SuggestionFilter = '_all' | 'high' | 'with' | 'none';

export default function ReviewPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [manualCategory, setManualCategory] = useState<Record<string, string>>({});
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionTypeFilter>('_all');
  const [suggestionFilter, setSuggestionFilter] = useState<SuggestionFilter>('_all');

  const utils = api.useContext();

  const { data: suggestionsData, isLoading } = api.suggestions.forUncategorized.useQuery(
    { limit: 50 }
  );
  const { data: unreviewedCount } = api.transactions.unreviewedCount.useQuery();
  const { data: categories } = api.categories.list.useQuery();

  const applySuggestion = api.suggestions.applySuggestion.useMutation(
    useToastCallbacks({
      successTitle: 'Category Applied',
      successDescription: 'Transaction has been categorized',
      errorTitle: 'Failed to apply suggestion',
    })
  );

  const applyBulk = api.suggestions.applyBulk.useMutation(
    useToastCallbacks({
      successTitle: 'Bulk Categorization Applied',
      successDescription: 'Selected transactions have been categorized',
      errorTitle: 'Failed to apply suggestions',
    })
  );

  const markReviewed = api.transactions.markReviewed.useMutation(
    useToastCallbacks({
      successTitle: 'Marked as Reviewed',
      successDescription: 'Transaction has been marked as reviewed',
      errorTitle: 'Failed to mark as reviewed',
    })
  );

  const bulkCategorize = api.transactions.bulkCategorize.useMutation(
    useToastCallbacks({
      successTitle: 'Bulk Category Applied',
      successDescription: 'Selected transactions have been categorized',
      errorTitle: 'Failed to apply bulk category',
    })
  );

  const filteredSuggestions = useMemo(() => {
    if (!suggestionsData) return [];

    const normalizedSearch = searchQuery.trim().toLowerCase();

    return suggestionsData.filter((item) => {
      const tx = item.transaction;
      const topSuggestion = item.suggestions[0];

      if (typeFilter !== '_all' && tx.type !== typeFilter) {
        return false;
      }

      if (suggestionFilter === 'high' && (!topSuggestion || topSuggestion.confidence < 0.9)) {
        return false;
      }
      if (suggestionFilter === 'with' && item.suggestions.length === 0) {
        return false;
      }
      if (suggestionFilter === 'none' && item.suggestions.length > 0) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = `${tx.merchantName ?? ''} ${tx.description}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [suggestionsData, searchQuery, typeFilter, suggestionFilter]);

  const visibleTransactionIds = useMemo(
    () => filteredSuggestions.map((item) => item.transactionId),
    [filteredSuggestions]
  );

  const selectedIdSet = useMemo(
    () => new Set(selectedTransactionIds),
    [selectedTransactionIds]
  );

  const allVisibleSelected =
    visibleTransactionIds.length > 0 &&
    visibleTransactionIds.every((id) => selectedIdSet.has(id));

  const highConfidenceCount = suggestionsData?.filter(
    (s) => s.suggestions.length > 0 && s.suggestions[0].confidence >= 0.9
  ).length ?? 0;

  useEffect(() => {
    if (!suggestionsData) {
      setSelectedTransactionIds([]);
      return;
    }

    const validIds = new Set(suggestionsData.map((item) => item.transactionId));
    setSelectedTransactionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [suggestionsData]);

  const refreshReviewData = async () => {
    await utils.suggestions.forUncategorized.invalidate();
    await utils.transactions.unreviewedCount.invalidate();
    await utils.dashboard.invalidate();
  };

  const handleApplySuggestion = async (transactionId: string, categoryId: string) => {
    await applySuggestion.mutateAsync({ transactionId, categoryId });
    setSelectedTransactionIds((prev) => prev.filter((id) => id !== transactionId));
    await refreshReviewData();
  };

  const handleSkip = async (transactionId: string) => {
    await markReviewed.mutateAsync({
      transactionIds: [transactionId],
      isReviewed: true,
    });
    setSelectedTransactionIds((prev) => prev.filter((id) => id !== transactionId));
    await refreshReviewData();
  };

  const handleManualCategorize = async (transactionId: string) => {
    const categoryId = manualCategory[transactionId];
    if (!categoryId) return;
    await handleApplySuggestion(transactionId, categoryId);
    setManualCategory((prev) => {
      const next = { ...prev };
      delete next[transactionId];
      return next;
    });
  };

  const handleApplyAll = async () => {
    if (!suggestionsData) return;
    const autoApplyable = suggestionsData
      .filter((s) => s.suggestions.length > 0 && s.suggestions[0].confidence >= 0.9)
      .map((s) => ({
        transactionId: s.transactionId,
        categoryId: s.suggestions[0].categoryId,
      }));

    if (autoApplyable.length === 0) return;

    await applyBulk.mutateAsync({ suggestions: autoApplyable });
    const autoAppliedIds = new Set(autoApplyable.map((item) => item.transactionId));
    setSelectedTransactionIds((prev) => prev.filter((id) => !autoAppliedIds.has(id)));
    await refreshReviewData();
  };

  const toggleSelected = (transactionId: string, checked: boolean) => {
    setSelectedTransactionIds((prev) => {
      if (checked) {
        if (prev.includes(transactionId)) return prev;
        return [...prev, transactionId];
      }
      return prev.filter((id) => id !== transactionId);
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);

      if (checked) {
        for (const id of visibleTransactionIds) {
          next.add(id);
        }
      } else {
        for (const id of visibleTransactionIds) {
          next.delete(id);
        }
      }

      return Array.from(next);
    });
  };

  const handleBulkAssignSelected = async () => {
    if (!bulkCategoryId || selectedTransactionIds.length === 0) return;

    await bulkCategorize.mutateAsync({
      transactionIds: selectedTransactionIds,
      categoryId: bulkCategoryId,
    });

    setSelectedTransactionIds([]);
    setBulkCategoryId('');
    await refreshReviewData();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Review Queue</h1>
            <p className="text-muted-foreground">
              {unreviewedCount ?? 0} unreviewed transaction{unreviewedCount !== 1 ? 's' : ''} remaining
            </p>
          </div>
          {highConfidenceCount > 0 && (
            <Button onClick={handleApplyAll} disabled={applyBulk.isLoading}>
              <Wand2 className="h-4 w-4 mr-2" />
              Auto-apply {highConfidenceCount} high-confidence suggestion{highConfidenceCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>

        <Card className="mb-4">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search merchant or description"
                  className="pl-8"
                />
              </div>
              <Select
                value={typeFilter}
                onValueChange={(v) => setTypeFilter(v as TransactionTypeFilter)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All types</SelectItem>
                  <SelectItem value="INCOME">Income</SelectItem>
                  <SelectItem value="EXPENSE">Expense</SelectItem>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={suggestionFilter}
                onValueChange={(v) => setSuggestionFilter(v as SuggestionFilter)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All suggestions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All suggestion states</SelectItem>
                  <SelectItem value="high">High confidence only</SelectItem>
                  <SelectItem value="with">With suggestions</SelectItem>
                  <SelectItem value="none">No suggestions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <p>
                Showing {filteredSuggestions.length} of {suggestionsData?.length ?? 0} transaction
                {(filteredSuggestions.length === 1 ? '' : 's')}
              </p>
              <p className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5" />
                Active filters: {(searchQuery ? 1 : 0) + (typeFilter !== '_all' ? 1 : 0) + (suggestionFilter !== '_all' ? 1 : 0)}
              </p>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !suggestionsData || suggestionsData.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
              <h2 className="text-xl font-semibold mb-2">All caught up!</h2>
              <p className="text-muted-foreground text-center max-w-md">
                No uncategorized transactions to review. New transactions from synced accounts will appear here.
              </p>
            </CardContent>
          </Card>
        ) : filteredSuggestions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <h2 className="text-xl font-semibold mb-2">No matches</h2>
              <p className="text-muted-foreground text-center max-w-md">
                No transactions matched the current review filters.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <Card>
              <CardContent className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <p className="text-sm text-muted-foreground">
                    {selectedTransactionIds.length} selected
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleSelectAllVisible(!allVisibleSelected)}
                  >
                    {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                  </Button>
                  {selectedTransactionIds.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTransactionIds([])}
                    >
                      Clear selection
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 w-full lg:w-auto">
                  <Select
                    value={bulkCategoryId || '_none'}
                    onValueChange={(v) => setBulkCategoryId(v === '_none' ? '' : v)}
                  >
                    <SelectTrigger className="w-full lg:w-72">
                      <SelectValue placeholder="Select category for selected..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Select category...</SelectItem>
                      {categories?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.icon} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleBulkAssignSelected}
                    disabled={
                      !bulkCategoryId ||
                      selectedTransactionIds.length === 0 ||
                      bulkCategorize.isLoading
                    }
                  >
                    Apply to Selected
                  </Button>
                </div>
              </CardContent>
            </Card>

            {filteredSuggestions.map((item) => {
              const tx = item.transaction;
              const topSuggestion = item.suggestions[0];
              const isExpanded = expandedId === item.transactionId;
              const isIncome = tx.type === 'INCOME';
              const isExpense = tx.type === 'EXPENSE';

              return (
                <Card key={item.transactionId}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        checked={selectedIdSet.has(item.transactionId)}
                        onChange={(e) => toggleSelected(item.transactionId, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-gray-300 shrink-0"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">
                            {tx.merchantName || tx.description}
                          </p>
                          <span className="text-sm text-muted-foreground shrink-0">
                            {formatDate(tx.date, { month: 'short', day: 'numeric' })}
                          </span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {tx.type}
                          </Badge>
                        </div>
                        {tx.merchantName && tx.description !== tx.merchantName && (
                          <p className="text-sm text-muted-foreground truncate">
                            {tx.description}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <p className={cn('font-semibold', transactionTypeColor(tx.type))}>
                          {isIncome ? '+' : isExpense ? '-' : ''}{formatCurrency(tx.amount)}
                        </p>
                      </div>

                      {topSuggestion ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <p className="text-sm font-medium">{topSuggestion.categoryName}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                              <Sparkles className="h-3 w-3" />
                              {Math.round(topSuggestion.confidence * 100)}% confidence
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleApplySuggestion(item.transactionId, topSuggestion.categoryId)}
                            disabled={applySuggestion.isLoading}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs shrink-0">
                          No suggestion
                        </Badge>
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => setExpandedId(isExpanded ? null : item.transactionId)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        {item.suggestions.length > 0 && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-2">
                              Suggested Categories
                            </p>
                            <div className="space-y-2">
                              {item.suggestions.map((suggestion, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between bg-muted rounded-md p-3"
                                >
                                  <div>
                                    <p className="font-medium text-sm">
                                      {suggestion.categoryName}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {suggestion.reason} ({Math.round(suggestion.confidence * 100)}%)
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      handleApplySuggestion(item.transactionId, suggestion.categoryId)
                                    }
                                    disabled={applySuggestion.isLoading}
                                  >
                                    Apply
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-2">
                            Manual Assignment
                          </p>
                          <div className="flex gap-2">
                            <Select
                              value={manualCategory[item.transactionId] || '_none'}
                              onValueChange={(v) =>
                                setManualCategory((prev) => ({
                                  ...prev,
                                  [item.transactionId]: v === '_none' ? '' : v,
                                }))
                              }
                            >
                              <SelectTrigger className="flex-1">
                                <SelectValue placeholder="Select category..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">Select category...</SelectItem>
                                {categories?.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.icon} {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              onClick={() => handleManualCategorize(item.transactionId)}
                              disabled={
                                !manualCategory[item.transactionId] ||
                                applySuggestion.isLoading
                              }
                            >
                              Apply
                            </Button>
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSkip(item.transactionId)}
                            disabled={markReviewed.isLoading}
                          >
                            <SkipForward className="h-4 w-4 mr-2" />
                            Skip (Mark as Reviewed)
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
