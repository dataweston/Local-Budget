'use client';

import { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, formatDate, cn, classificationColor } from '@/lib/utils';
import { useToastCallbacks } from '@/hooks/use-toast-mutation';
import {
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  SkipForward,
  Wand2,
} from 'lucide-react';

export default function ReviewPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [manualCategory, setManualCategory] = useState<Record<string, string>>({});

  const utils = api.useContext();

  // Fetch uncategorized transactions with suggestions
  const { data: suggestionsData, isLoading } = api.suggestions.forUncategorized.useQuery(
    { limit: 50 }
  );

  // Fetch unreviewed count
  const { data: unreviewedCount } = api.transactions.unreviewedCount.useQuery();

  // Fetch categories for manual assignment
  const { data: categories } = api.categories.list.useQuery();

  // Apply single suggestion
  const applySuggestion = api.suggestions.applySuggestion.useMutation(
    useToastCallbacks({
      successTitle: 'Category Applied',
      successDescription: 'Transaction has been categorized',
      errorTitle: 'Failed to apply suggestion',
    })
  );

  // Apply bulk suggestions
  const applyBulk = api.suggestions.applyBulk.useMutation(
    useToastCallbacks({
      successTitle: 'Bulk Categorization Applied',
      successDescription: 'Selected transactions have been categorized',
      errorTitle: 'Failed to apply suggestions',
    })
  );

  // Mark reviewed
  const markReviewed = api.transactions.markReviewed.useMutation(
    useToastCallbacks({
      successTitle: 'Marked as Reviewed',
      successDescription: 'Transaction has been marked as reviewed',
      errorTitle: 'Failed to mark as reviewed',
    })
  );

  const handleApplySuggestion = async (transactionId: string, categoryId: string) => {
    await applySuggestion.mutateAsync({ transactionId, categoryId });
    await utils.suggestions.forUncategorized.invalidate();
    await utils.transactions.unreviewedCount.invalidate();
    await utils.dashboard.invalidate();
  };

  const handleSkip = async (transactionId: string) => {
    await markReviewed.mutateAsync({
      transactionIds: [transactionId],
      isReviewed: true,
    });
    await utils.suggestions.forUncategorized.invalidate();
    await utils.transactions.unreviewedCount.invalidate();
    await utils.dashboard.invalidate();
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

  // Auto-apply: apply all high-confidence suggestions at once
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
    await utils.suggestions.forUncategorized.invalidate();
    await utils.transactions.unreviewedCount.invalidate();
    await utils.dashboard.invalidate();
  };

  const highConfidenceCount = suggestionsData?.filter(
    (s) => s.suggestions.length > 0 && s.suggestions[0].confidence >= 0.9
  ).length ?? 0;

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
            <Button
              onClick={handleApplyAll}
              disabled={applyBulk.isLoading}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Auto-apply {highConfidenceCount} high-confidence suggestion{highConfidenceCount !== 1 ? 's' : ''}
            </Button>
          )}
        </div>

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
        ) : (
          <div className="space-y-3">
            {suggestionsData.map((item) => {
              const tx = item.transaction;
              const topSuggestion = item.suggestions[0];
              const isExpanded = expandedId === item.transactionId;

              return (
                <Card key={item.transactionId}>
                  <CardContent className="p-4">
                    {/* Main Row */}
                    <div className="flex items-center gap-4">
                      {/* Transaction Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">
                            {tx.merchantName || tx.description}
                          </p>
                          <span className="text-sm text-muted-foreground shrink-0">
                            {formatDate(tx.date, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        {tx.merchantName && tx.description !== tx.merchantName && (
                          <p className="text-sm text-muted-foreground truncate">
                            {tx.description}
                          </p>
                        )}
                      </div>

                      {/* Amount */}
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-red-600">
                          {formatCurrency(tx.amount)}
                        </p>
                      </div>

                      {/* Top Suggestion - Quick Apply */}
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

                      {/* Expand / Skip */}
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

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        {/* All suggestions */}
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
                                      handleApplySuggestion(
                                        item.transactionId,
                                        suggestion.categoryId
                                      )
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

                        {/* Manual assignment */}
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

                        {/* Skip button */}
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
