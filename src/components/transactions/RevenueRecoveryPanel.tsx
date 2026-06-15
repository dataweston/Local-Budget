'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/trpc';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatDate } from '@/lib/utils';
import { AlertTriangle, ChevronDown, ChevronUp, Check, X } from 'lucide-react';

/**
 * Surfaces INCOME transactions wrongly classified TRANSFER (and so excluded
 * from the P&L) for review. Clearing the TRANSFER classification lets it fall
 * back to revenue. Review-only: nothing is written without an explicit click,
 * and the user picks exactly which rows. See src/lib/reclassify.ts.
 */
export function RevenueRecoveryPanel() {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [lastCleared, setLastCleared] = useState<number | null>(null);

  const utils = api.useUtils();
  const { data, isLoading } = api.transactions.misclassifiedRevenue.useQuery({ limit: 500 });

  const clearMutation = api.transactions.clearTransferClassification.useMutation({
    onSuccess: async (res) => {
      setLastCleared(res.cleared);
      setSelected(new Set());
      await Promise.all([
        utils.transactions.misclassifiedRevenue.invalidate(),
        utils.transactions.list.invalidate(),
      ]);
    },
  });

  const suspects = data?.transactions ?? [];

  // Default every suspect to selected once they load — the common case is
  // "yes, these are all revenue"; deselect the rare exception by hand.
  useEffect(() => {
    if (suspects.length > 0) {
      setSelected(new Set(suspects.map((t) => t.id)));
    }
  }, [suspects]);

  const selectedTotal = useMemo(
    () =>
      suspects
        .filter((t) => selected.has(t.id))
        .reduce((sum, t) => sum + Number(t.amount), 0),
    [suspects, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === suspects.length ? new Set() : new Set(suspects.map((t) => t.id))
    );
  }

  if (dismissed) return null;
  if (isLoading) return <Skeleton className="h-20 mb-4" />;
  if (!data || data.suspectCount === 0) return null;

  return (
    <Card className="mb-4 border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <CardTitle className="text-base">
              {data.suspectCount} transaction{data.suspectCount === 1 ? '' : 's'} may be
              revenue marked as Transfer
            </CardTitle>
            <CardDescription>
              {formatCurrency(data.suspectAmount)} of income is classified as
              Transfer and excluded from your P&amp;L. Review and clear the
              Transfer tag to count it as revenue.
              {lastCleared !== null && (
                <span className="ml-1 font-medium text-green-700 dark:text-green-400">
                  Cleared {lastCleared}.
                </span>
              )}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" /> Hide
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" /> Review
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDismissed(true)}
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {selected.size === suspects.length ? 'Deselect all' : 'Select all'}
            </button>
            <Button
              size="sm"
              disabled={selected.size === 0 || clearMutation.isLoading}
              onClick={() =>
                clearMutation.mutate({ transactionIds: Array.from(selected) })
              }
            >
              <Check className="h-4 w-4 mr-2" />
              {clearMutation.isLoading
                ? 'Clearing…'
                : `Mark ${selected.size} as revenue (${formatCurrency(selectedTotal)})`}
            </Button>
          </div>

          <div className="divide-y rounded-md border bg-background">
            {suspects.map((tx) => (
              <label
                key={tx.id}
                className="grid grid-cols-12 gap-3 px-3 py-2 items-center cursor-pointer hover:bg-accent/40"
              >
                <input
                  type="checkbox"
                  className="col-span-1 h-4 w-4 accent-amber-600"
                  checked={selected.has(tx.id)}
                  onChange={() => toggle(tx.id)}
                />
                <span className="col-span-2 text-sm text-muted-foreground">
                  {formatDate(tx.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="col-span-5 text-sm truncate">
                  {tx.merchantName || tx.description}
                </span>
                <span className="col-span-2 text-xs text-muted-foreground truncate">
                  {tx.account?.name}
                </span>
                <span className="col-span-2 text-right text-sm font-semibold text-green-600">
                  +{formatCurrency(Number(tx.amount))}
                </span>
              </label>
            ))}
          </div>

          {data.suspectCount > suspects.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {suspects.length} of {data.suspectCount}. Clear these and the
              rest will appear.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {data.totalMarkedTransfer} income transactions are marked Transfer in
            total; the {data.suspectCount} above don&apos;t look like internal
            transfers. Genuine transfers are left untouched.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
