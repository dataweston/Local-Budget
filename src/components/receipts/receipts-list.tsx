'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { UploadReceiptModal } from './UploadReceiptModal';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import {
  DateRangeSelector,
  getDateRangeForPreset,
  type PeriodPreset,
} from '@/components/ui/date-range-selector';
import {
  Upload,
  FileText,
  Link2,
  CheckCircle2,
  Clock,
  XCircle,
  Image as ImageIcon,
  Package,
  Wallet,
} from 'lucide-react';

interface ReceiptData {
  id: string;
  fileName: string;
  fileUrl?: string | null;
  fileType: string;
  vendorName?: string | null;
  totalAmount?: any;
  receiptDate?: Date | string | null;
  status: string;
  createdAt: Date | string;
  transactionLinks: any[];
  _count: { lineItems: number };
}

type AmazonOrderMatchMeta = {
  orderId?: string;
  itemCount?: number;
  confidence?: string;
  orderPlaced?: string;
  dayDiff?: number | null;
  candidateCount?: number;
  itemTitles?: string[];
  matchStatus?: string;
};

function parseAmazonOrderMatchMeta(metadata: unknown): AmazonOrderMatchMeta {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const amazonOrderMatch = (metadata as Record<string, unknown>).amazonOrderMatch;
  if (
    !amazonOrderMatch ||
    typeof amazonOrderMatch !== 'object' ||
    Array.isArray(amazonOrderMatch)
  ) {
    return {};
  }
  const m = amazonOrderMatch as Record<string, unknown>;
  return {
    orderId: typeof m.orderId === 'string' ? m.orderId : undefined,
    itemCount: typeof m.itemCount === 'number' ? m.itemCount : undefined,
    confidence: typeof m.confidence === 'string' ? m.confidence : undefined,
    orderPlaced: typeof m.orderPlaced === 'string' ? m.orderPlaced : undefined,
    dayDiff: typeof m.dayDiff === 'number' ? m.dayDiff : null,
    candidateCount: typeof m.candidateCount === 'number' ? m.candidateCount : undefined,
    itemTitles: Array.isArray(m.itemTitles)
      ? m.itemTitles.filter((x): x is string => typeof x === 'string')
      : undefined,
    matchStatus: typeof m.matchStatus === 'string' ? m.matchStatus : undefined,
  };
}

type VenmoStatementMatchMeta = {
  statementId?: string;
  statementDateTime?: string;
  type?: string;
  status?: string;
  note?: string;
  from?: string;
  to?: string;
  amountTotalSigned?: number;
  amountFeeSigned?: number;
  sourceFile?: string;
  confidence?: string;
  dayDiff?: number | null;
  candidateCount?: number;
};

function parseVenmoStatementMatchMeta(metadata: unknown): VenmoStatementMatchMeta {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const venmoStatementMatch = (metadata as Record<string, unknown>).venmoStatementMatch;
  if (
    !venmoStatementMatch ||
    typeof venmoStatementMatch !== 'object' ||
    Array.isArray(venmoStatementMatch)
  ) {
    return {};
  }
  const m = venmoStatementMatch as Record<string, unknown>;
  return {
    statementId: typeof m.statementId === 'string' ? m.statementId : undefined,
    statementDateTime: typeof m.statementDateTime === 'string' ? m.statementDateTime : undefined,
    type: typeof m.type === 'string' ? m.type : undefined,
    status: typeof m.status === 'string' ? m.status : undefined,
    note: typeof m.note === 'string' ? m.note : undefined,
    from: typeof m.from === 'string' ? m.from : undefined,
    to: typeof m.to === 'string' ? m.to : undefined,
    amountTotalSigned: typeof m.amountTotalSigned === 'number' ? m.amountTotalSigned : undefined,
    amountFeeSigned: typeof m.amountFeeSigned === 'number' ? m.amountFeeSigned : undefined,
    sourceFile: typeof m.sourceFile === 'string' ? m.sourceFile : undefined,
    confidence: typeof m.confidence === 'string' ? m.confidence : undefined,
    dayDiff: typeof m.dayDiff === 'number' ? m.dayDiff : null,
    candidateCount: typeof m.candidateCount === 'number' ? m.candidateCount : undefined,
  };
}

const statusConfig = {
  PENDING: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  PROCESSING: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
  PROCESSED: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  FAILED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  REVIEWED: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
};

type MatchFilterValue = 'all' | 'matched' | 'unmatched' | 'pending';
type IngestSectionValue = 'amazon' | 'venmo';
type VenmoTypeFilterValue = 'all' | 'income' | 'expense';
type VenmoMatchFilterValue = 'all' | 'matched' | 'unmatched';
type VenmoSortValue = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

export function ReceiptsList() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [selectedAmazonTxId, setSelectedAmazonTxId] = useState<string | null>(null);
  const [selectedVenmoTxId, setSelectedVenmoTxId] = useState<string | null>(null);
  const [ingestSection, setIngestSection] = useState<IngestSectionValue>('amazon');
  const [amazonPeriod, setAmazonPeriod] = useState<PeriodPreset>('all-time');
  const [amazonYearValue, setAmazonYearValue] = useState<number>(new Date().getFullYear());
  const [amazonCustomStart, setAmazonCustomStart] = useState('');
  const [amazonCustomEnd, setAmazonCustomEnd] = useState('');
  const [updatingBusinessPersonalTxId, setUpdatingBusinessPersonalTxId] = useState<string | null>(null);
  const [venmoPeriod, setVenmoPeriod] = useState<PeriodPreset>('all-time');
  const [venmoYearValue, setVenmoYearValue] = useState<number>(new Date().getFullYear());
  const [venmoCustomStart, setVenmoCustomStart] = useState('');
  const [venmoCustomEnd, setVenmoCustomEnd] = useState('');
  const [updatingVenmoBusinessPersonalTxId, setUpdatingVenmoBusinessPersonalTxId] = useState<string | null>(null);
  const [amazonMatchFilter, setAmazonMatchFilter] = useState<MatchFilterValue>('all');
  const [amazonAccountFilter, setAmazonAccountFilter] = useState<string | undefined>();
  const [venmoTypeFilter, setVenmoTypeFilter] = useState<VenmoTypeFilterValue>('all');
  const [venmoMatchFilter, setVenmoMatchFilter] = useState<VenmoMatchFilterValue>('all');
  const [venmoAccountFilter, setVenmoAccountFilter] = useState<string | undefined>();
  const [venmoSort, setVenmoSort] = useState<VenmoSortValue>('date-desc');
  const [selectedAmazonIds, setSelectedAmazonIds] = useState<Set<string>>(new Set());
  const utils = api.useUtils();

  const { data, isLoading, refetch } = api.receipts.list.useQuery({
    status: statusFilter as any,
  });

  const { data: pendingCount } = api.receipts.pendingCount.useQuery();
  const { data: unlinkedReceipts } = api.receipts.unlinked.useQuery();
  const amazonDateRange = useMemo(() => {
    if (amazonPeriod === 'custom' && amazonCustomStart && amazonCustomEnd) {
      return {
        startDate: new Date(amazonCustomStart + 'T00:00:00'),
        endDate: new Date(amazonCustomEnd + 'T23:59:59.999'),
      };
    }
    const range = getDateRangeForPreset(amazonPeriod, { year: amazonYearValue });
    return { startDate: range.startDate, endDate: range.endDate };
  }, [amazonPeriod, amazonYearValue, amazonCustomStart, amazonCustomEnd]);

  const venmoDateRange = useMemo(() => {
    if (venmoPeriod === 'custom' && venmoCustomStart && venmoCustomEnd) {
      return {
        startDate: new Date(venmoCustomStart + 'T00:00:00'),
        endDate: new Date(venmoCustomEnd + 'T23:59:59.999'),
      };
    }
    const range = getDateRangeForPreset(venmoPeriod, { year: venmoYearValue });
    return { startDate: range.startDate, endDate: range.endDate };
  }, [venmoPeriod, venmoYearValue, venmoCustomStart, venmoCustomEnd]);

  const { data: amazonSpending, isLoading: isAmazonSpendingLoading } =
    api.receipts.amazonSpending.useQuery({
      startDate: amazonDateRange.startDate,
      endDate: amazonDateRange.endDate,
      limit: 1000,
      accountId: amazonAccountFilter,
      matchFilter: amazonMatchFilter === 'all' ? undefined : amazonMatchFilter,
    });
  const { data: venmoSpending, isLoading: isVenmoSpendingLoading } =
    api.receipts.venmoSpending.useQuery({
      startDate: venmoDateRange.startDate,
      endDate: venmoDateRange.endDate,
      limit: 1000,
      typeFilter: venmoTypeFilter === 'all' ? undefined : venmoTypeFilter,
      matchFilter: venmoMatchFilter === 'all' ? undefined : venmoMatchFilter,
      accountId: venmoAccountFilter,
      sortBy: venmoSort,
    });

  const invalidateAmazon = useCallback(async () => {
    await utils.receipts.amazonSpending.invalidate();
  }, [utils.receipts.amazonSpending]);

  const updateTransactionMutation = api.transactions.update.useMutation({
    onSuccess: async (_, vars) => {
      await Promise.all([
        invalidateAmazon(),
        utils.receipts.venmoSpending.invalidate(),
        utils.transactions.getById.invalidate({ id: vars.id }),
      ]);
    },
    onSettled: () => {
      setUpdatingBusinessPersonalTxId(null);
      setUpdatingVenmoBusinessPersonalTxId(null);
    },
  });
  const enforceAmazonRoutingMutation = api.receipts.enforceAmazonRouting.useMutation({
    onSuccess: invalidateAmazon,
  });
  const approveMatchMutation = api.receipts.approveAmazonMatch.useMutation({
    onSuccess: async () => {
      await invalidateAmazon();
      if (selectedAmazonTxId) {
        await utils.transactions.getById.invalidate({ id: selectedAmazonTxId });
      }
    },
  });
  const rejectMatchMutation = api.receipts.rejectAmazonMatch.useMutation({
    onSuccess: async () => {
      await invalidateAmazon();
      setSelectedAmazonTxId(null);
    },
  });
  const bulkApproveMutation = api.receipts.bulkApproveAmazonMatches.useMutation({
    onSuccess: async () => {
      await invalidateAmazon();
      setSelectedAmazonIds(new Set());
    },
  });
  const batchClassifyMutation = api.receipts.batchClassifyAmazon.useMutation({
    onSuccess: async () => {
      await invalidateAmazon();
      setSelectedAmazonIds(new Set());
    },
  });

  const { data: selectedAmazonTx, isLoading: isSelectedAmazonTxLoading } =
    api.transactions.getById.useQuery(
      { id: selectedAmazonTxId ?? '' },
      { enabled: !!selectedAmazonTxId }
    );
  const { data: selectedVenmoTx, isLoading: isSelectedVenmoTxLoading } =
    api.transactions.getById.useQuery(
      { id: selectedVenmoTxId ?? '' },
      { enabled: !!selectedVenmoTxId }
    );
  const selectedAmazonMeta = selectedAmazonTx
    ? parseAmazonOrderMatchMeta(selectedAmazonTx.metadata)
    : null;
  const selectedVenmoMeta = selectedVenmoTx
    ? parseVenmoStatementMatchMeta(selectedVenmoTx.metadata)
    : null;

  function markAmazonBusinessPersonal(transactionId: string, mode: 'business' | 'personal') {
    setUpdatingBusinessPersonalTxId(transactionId);
    updateTransactionMutation.mutate({
      id: transactionId,
      data: { classification: mode === 'business' ? 'OPERATING' : 'PERSONAL' },
    });
  }

  function markVenmoBusinessPersonal(transactionId: string, mode: 'business' | 'personal') {
    setUpdatingVenmoBusinessPersonalTxId(transactionId);
    updateTransactionMutation.mutate({
      id: transactionId,
      data: { classification: mode === 'business' ? 'OPERATING' : 'PERSONAL' },
    });
  }

  function toggleAmazonSelection(id: string) {
    setSelectedAmazonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllAmazon() {
    if (!amazonSpending) return;
    if (selectedAmazonIds.size === amazonSpending.data.length) {
      setSelectedAmazonIds(new Set());
    } else {
      setSelectedAmazonIds(new Set(amazonSpending.data.map((tx) => tx.id)));
    }
  }

  const hasPendingInSelection = useMemo(() => {
    if (!amazonSpending || selectedAmazonIds.size === 0) return false;
    return amazonSpending.data.some(
      (tx) => selectedAmazonIds.has(tx.id) && tx.matchStatus === 'pending'
    );
  }, [amazonSpending, selectedAmazonIds]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        {/* Stats Row */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Receipts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{data?.pagination.total ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pending Processing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-yellow-600">
                {pendingCount ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Unlinked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">
                {unlinkedReceipts?.length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card className="flex items-center justify-center">
            <UploadReceiptModal
              onSuccess={() => refetch()}
              trigger={
                <Button size="lg" className="gap-2">
                  <Upload className="h-5 w-5" />
                  Upload Receipt
                </Button>
              }
            />
          </Card>
        </div>

        {/* Ingest Source Sections */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Ingested Categories</CardTitle>
                <CardDescription>
                  Use tabs to switch between source-specific transaction views
                </CardDescription>
              </div>
              <Tabs
                value={ingestSection}
                onValueChange={(v) => {
                  setIngestSection(v as IngestSectionValue);
                  setSelectedAmazonIds(new Set());
                }}
              >
                <TabsList>
                  <TabsTrigger value="amazon" className="gap-1">
                    <Package className="h-4 w-4" />
                    Amazon
                  </TabsTrigger>
                  <TabsTrigger value="venmo" className="gap-1">
                    <Wallet className="h-4 w-4" />
                    Venmo
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
        </Card>

        {ingestSection === 'amazon' && (
          <>
            {/* Amazon Spending Section */}
            <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-amber-600" />
                    Amazon Spending
                  </CardTitle>
                  <CardDescription>
                    All Amazon/AMZN transactions with routing + ingest-match status
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <DateRangeSelector
                    value={amazonPeriod}
                    onChange={setAmazonPeriod}
                    yearValue={amazonYearValue}
                    onYearChange={setAmazonYearValue}
                    customStart={amazonCustomStart}
                    customEnd={amazonCustomEnd}
                    onCustomStartChange={setAmazonCustomStart}
                    onCustomEndChange={setAmazonCustomEnd}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={enforceAmazonRoutingMutation.isPending}
                    onClick={() => enforceAmazonRoutingMutation.mutate()}
                  >
                    {enforceAmazonRoutingMutation.isPending
                      ? 'Routing...'
                      : 'Backfill Routing'}
                  </Button>
                </div>
              </div>

              {/* Filters row */}
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={amazonMatchFilter}
                  onValueChange={(v) => {
                    setAmazonMatchFilter(v as MatchFilterValue);
                    setSelectedAmazonIds(new Set());
                  }}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue placeholder="Match status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="matched">Matched</SelectItem>
                    <SelectItem value="unmatched">Unmatched</SelectItem>
                    <SelectItem value="pending">
                      Pending{amazonSpending?.pendingMatchCount ? ` (${amazonSpending.pendingMatchCount})` : ''}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={amazonAccountFilter ?? '__all__'}
                  onValueChange={(v) => {
                    setAmazonAccountFilter(v === '__all__' ? undefined : v);
                    setSelectedAmazonIds(new Set());
                  }}
                >
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All accounts</SelectItem>
                    {amazonSpending?.accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Purchases</p>
                  <p className="text-lg font-semibold">{amazonSpending?.totalCount ?? 0}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-lg font-semibold">
                    {formatCurrency(Number(amazonSpending?.totalAmount ?? 0))}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Business</p>
                  <p className="text-lg font-semibold text-green-700">
                    {formatCurrency(Number(amazonSpending?.businessAmount ?? 0))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {amazonSpending?.businessCount ?? 0} tx
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Personal</p>
                  <p className="text-lg font-semibold text-orange-700">
                    {formatCurrency(Number(amazonSpending?.personalAmount ?? 0))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {amazonSpending?.personalCount ?? 0} tx
                  </p>
                </div>
              </div>
              {!!enforceAmazonRoutingMutation.data && (
                <p className="text-xs text-muted-foreground">
                  Routed {enforceAmazonRoutingMutation.data.updated} transaction(s):{' '}
                  {enforceAmazonRoutingMutation.data.routedAmazon} to Materials &gt; amazon and{' '}
                  {enforceAmazonRoutingMutation.data.routedVideo} digital subscription(s) to Tools and software.
                </p>
              )}
              {enforceAmazonRoutingMutation.error && (
                <p className="text-xs text-red-600">
                  {enforceAmazonRoutingMutation.error.message}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isAmazonSpendingLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : !amazonSpending || amazonSpending.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Amazon transactions found for this period.</p>
            ) : (
              <div className="space-y-2">
                {/* Select all row */}
                <div className="flex items-center gap-2 px-3 py-1">
                  <input
                    type="checkbox"
                    checked={selectedAmazonIds.size === amazonSpending.data.length && amazonSpending.data.length > 0}
                    onChange={toggleAllAmazon}
                    className="h-4 w-4 rounded border-gray-300 accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">
                    Select all ({amazonSpending.data.length})
                  </span>
                </div>

                {amazonSpending.data.map((tx) => {
                  const meta = parseAmazonOrderMatchMeta(tx.metadata);
                  const metadataItems = meta.itemTitles ?? [];
                  const firstItem =
                    tx.lineItems[0]?.description.replace(/^\[Amazon\]\s*/, '') ?? null;
                  const itemCount = meta.itemCount ?? metadataItems.length;
                  const needsManualSplit = itemCount > 1 && tx.lineItems.length === 0;
                  const isBusiness = tx.effectiveClassification !== 'PERSONAL';
                  const isSelected = selectedAmazonIds.has(tx.id);
                  return (
                    <div
                      key={tx.id}
                      className={cn(
                        'rounded-md border px-3 py-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between',
                        isSelected && 'bg-accent/50 border-primary/30',
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleAmazonSelection(tx.id)}
                          className="h-4 w-4 shrink-0 rounded border-gray-300 accent-primary"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {firstItem || metadataItems[0] || tx.merchantName || tx.description}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatDate(tx.date)} - {tx.account.name}
                            {meta.orderId ? ` - Order ${meta.orderId}` : ''}
                            {itemCount > 0 ? ` - ${itemCount} item(s)` : ''}
                            {tx.category?.name ? ` - ${tx.category.name}` : ' - Uncategorized'}
                            {` - Tx ${tx.id.slice(-8)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {/* Match status badges */}
                        {tx.matchStatus === 'pending' ? (
                          <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-400 bg-yellow-50">
                            Pending Match
                          </Badge>
                        ) : tx.matchStatus === 'approved' ? (
                          <Badge variant="default" className="text-[10px]">
                            Matched
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Bank Only
                          </Badge>
                        )}
                        {needsManualSplit && (
                          <Badge variant="secondary" className="text-[10px]">
                            Multi-item
                          </Badge>
                        )}
                        {meta.confidence && (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {meta.confidence}
                          </Badge>
                        )}
                        <p className="text-sm font-semibold">
                          {formatCurrency(Number(tx.amount))}
                        </p>
                        <div className="flex items-center rounded-md border overflow-hidden">
                          <Button
                            size="sm"
                            variant={isBusiness ? 'default' : 'ghost'}
                            className="h-7 rounded-none px-2"
                            disabled={updatingBusinessPersonalTxId === tx.id}
                            onClick={() => markAmazonBusinessPersonal(tx.id, 'business')}
                          >
                            Business
                          </Button>
                          <Button
                            size="sm"
                            variant={!isBusiness ? 'default' : 'ghost'}
                            className="h-7 rounded-none px-2"
                            disabled={updatingBusinessPersonalTxId === tx.id}
                            onClick={() => markAmazonBusinessPersonal(tx.id, 'personal')}
                          >
                            Personal
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedAmazonTxId(tx.id)}
                        >
                          View Match
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Batch action bar */}
        {selectedAmazonIds.size > 0 && (
          <div className="sticky bottom-4 z-50 mx-auto w-fit rounded-lg border bg-background p-3 shadow-lg flex items-center gap-3">
            <span className="text-sm font-medium">{selectedAmazonIds.size} selected</span>
            <Button
              size="sm"
              disabled={batchClassifyMutation.isPending}
              onClick={() => batchClassifyMutation.mutate({
                transactionIds: Array.from(selectedAmazonIds),
                classification: 'OPERATING',
              })}
            >
              Mark Business
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={batchClassifyMutation.isPending}
              onClick={() => batchClassifyMutation.mutate({
                transactionIds: Array.from(selectedAmazonIds),
                classification: 'PERSONAL',
              })}
            >
              Mark Personal
            </Button>
            {hasPendingInSelection && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkApproveMutation.isPending}
                onClick={() => bulkApproveMutation.mutate({
                  transactionIds: Array.from(selectedAmazonIds),
                })}
              >
                {bulkApproveMutation.isPending ? 'Approving...' : 'Approve Matches'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedAmazonIds(new Set())}
            >
              Clear
            </Button>
          </div>
        )}
          </>
        )}

        {ingestSection === 'venmo' && (
          <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-sky-600" />
                    Venmo Transactions
                  </CardTitle>
                  <CardDescription>
                    View Venmo income and expense activity with account and match filters
                  </CardDescription>
                </div>
                <DateRangeSelector
                  value={venmoPeriod}
                  onChange={setVenmoPeriod}
                  yearValue={venmoYearValue}
                  onYearChange={setVenmoYearValue}
                  customStart={venmoCustomStart}
                  customEnd={venmoCustomEnd}
                  onCustomStartChange={setVenmoCustomStart}
                  onCustomEndChange={setVenmoCustomEnd}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={venmoTypeFilter}
                  onValueChange={(v) => setVenmoTypeFilter(v as VenmoTypeFilterValue)}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={venmoMatchFilter}
                  onValueChange={(v) => setVenmoMatchFilter(v as VenmoMatchFilterValue)}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue placeholder="Match status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All matches</SelectItem>
                    <SelectItem value="matched">Matched</SelectItem>
                    <SelectItem value="unmatched">Unmatched</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={venmoAccountFilter ?? '__all__'}
                  onValueChange={(v) => setVenmoAccountFilter(v === '__all__' ? undefined : v)}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All accounts</SelectItem>
                    {venmoSpending?.accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={venmoSort}
                  onValueChange={(v) => setVenmoSort(v as VenmoSortValue)}
                >
                  <SelectTrigger className="w-[150px] h-8 text-xs">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date-desc">Newest first</SelectItem>
                    <SelectItem value="date-asc">Oldest first</SelectItem>
                    <SelectItem value="amount-desc">Amount high-low</SelectItem>
                    <SelectItem value="amount-asc">Amount low-high</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Transactions</p>
                  <p className="text-lg font-semibold">{venmoSpending?.totalCount ?? 0}</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Income</p>
                  <p className="text-lg font-semibold text-green-700">
                    {formatCurrency(Number(venmoSpending?.incomeAmount ?? 0))}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Expense</p>
                  <p className="text-lg font-semibold text-orange-700">
                    {formatCurrency(Number(venmoSpending?.expenseAmount ?? 0))}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Net</p>
                  <p
                    className={cn(
                      'text-lg font-semibold',
                      Number(venmoSpending?.netAmount ?? 0) >= 0
                        ? 'text-green-700'
                        : 'text-orange-700',
                    )}
                  >
                    {formatCurrency(Number(venmoSpending?.netAmount ?? 0))}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Matched</p>
                  <p className="text-lg font-semibold text-sky-700">
                    {venmoSpending?.matchedCount ?? 0}
                  </p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Unmatched</p>
                  <p className="text-lg font-semibold">
                    {venmoSpending?.unmatchedCount ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isVenmoSpendingLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : !venmoSpending || venmoSpending.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Venmo transactions found for this filter set.</p>
            ) : (
              <div className="space-y-2">
                {venmoSpending.data.map((tx) => {
                  const meta = parseVenmoStatementMatchMeta(tx.metadata);
                  const isBusiness = tx.effectiveClassification !== 'PERSONAL';
                  const isIncome = tx.type === 'INCOME';
                  const primaryText =
                    meta.note ||
                    meta.to ||
                    meta.from ||
                    tx.merchantName ||
                    tx.description;
                  return (
                    <div
                      key={tx.id}
                      className="rounded-md border px-3 py-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{primaryText}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatDate(tx.date)} - {tx.account.name}
                          {tx.category?.name ? ` - ${tx.category.name}` : ' - Uncategorized'}
                          {meta.statementId ? ` - Statement ${meta.statementId}` : ''}
                          {` - Tx ${tx.id.slice(-8)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Badge variant={isIncome ? 'default' : 'secondary'} className="text-[10px]">
                          {isIncome ? 'Income' : 'Expense'}
                        </Badge>
                        {tx.hasVenmoStatementMatch ? (
                          <Badge variant="default" className="text-[10px]">
                            Statement Matched
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Unmatched
                          </Badge>
                        )}
                        {meta.confidence && (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {meta.confidence}
                          </Badge>
                        )}
                        <p
                          className={cn(
                            'text-sm font-semibold',
                            isIncome ? 'text-green-700' : 'text-orange-700',
                          )}
                        >
                          {formatCurrency(Number(tx.amount))}
                        </p>
                        <div className="flex items-center rounded-md border overflow-hidden">
                          <Button
                            size="sm"
                            variant={isBusiness ? 'default' : 'ghost'}
                            className="h-7 rounded-none px-2"
                            disabled={updatingVenmoBusinessPersonalTxId === tx.id}
                            onClick={() => markVenmoBusinessPersonal(tx.id, 'business')}
                          >
                            Business
                          </Button>
                          <Button
                            size="sm"
                            variant={!isBusiness ? 'default' : 'ghost'}
                            className="h-7 rounded-none px-2"
                            disabled={updatingVenmoBusinessPersonalTxId === tx.id}
                            onClick={() => markVenmoBusinessPersonal(tx.id, 'personal')}
                          >
                            Personal
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedVenmoTxId(tx.id)}
                        >
                          View Match
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
          </Card>
        )}

        {/* Receipts List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Receipts</CardTitle>
                <CardDescription>
                  Manage and link your receipts to transactions
                </CardDescription>
              </div>
              <Tabs value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? undefined : v)}>
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="PENDING">Pending</TabsTrigger>
                  <TabsTrigger value="PROCESSED">Processed</TabsTrigger>
                  <TabsTrigger value="REVIEWED">Reviewed</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : data?.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No receipts yet</p>
                <p className="text-sm">Upload your first receipt to get started</p>
                <Button className="mt-4 gap-2" asChild>
                  <UploadReceiptModal
                    onSuccess={() => refetch()}
                    trigger={
                      <span className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        Upload Receipt
                      </span>
                    }
                  />
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data?.data.map((receipt) => {
                  const status = statusConfig[receipt.status];
                  const StatusIcon = status.icon;

                  return (
                    <Card
                      key={receipt.id}
                      className="hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => setSelectedReceipt(receipt as ReceiptData)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                            {receipt.fileType.includes('image') ? (
                              <ImageIcon className="h-6 w-6 text-muted-foreground" />
                            ) : (
                              <FileText className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {receipt.vendorName || receipt.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(receipt.createdAt)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn('text-xs', status.color, status.bg)}
                          >
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {receipt.status}
                          </Badge>
                        </div>

                        {receipt.totalAmount && (
                          <div className="mt-3 p-2 rounded-lg bg-muted">
                            <p className="text-lg font-bold">
                              {formatCurrency(Number(receipt.totalAmount))}
                            </p>
                            {receipt.receiptDate && (
                              <p className="text-xs text-muted-foreground">
                                Receipt date: {formatDate(receipt.receiptDate)}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Link2 className="h-3 w-3" />
                            {receipt.transactionLinks.length > 0 ? (
                              <span className="text-green-600">
                                Linked to {receipt.transactionLinks.length} transaction(s)
                              </span>
                            ) : (
                              <span className="text-orange-600">Not linked</span>
                            )}
                          </div>
                          {receipt._count.lineItems > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {receipt._count.lineItems} items
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Amazon Match Detail Dialog */}
        <Dialog
          open={!!selectedAmazonTxId}
          onOpenChange={(open) => !open && setSelectedAmazonTxId(null)}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedAmazonTx
                  ? `Amazon Match${selectedAmazonMeta?.orderId ? ` - Order ${selectedAmazonMeta.orderId}` : ''}`
                  : 'Amazon Match'}
              </DialogTitle>
              <DialogDescription>
                Review the matched transaction and order contents
              </DialogDescription>
            </DialogHeader>
            {isSelectedAmazonTxLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : !selectedAmazonTx ? (
              <p className="text-sm text-muted-foreground">
                Matched transaction not found.
              </p>
            ) : (
              (() => {
                const meta = parseAmazonOrderMatchMeta(selectedAmazonTx.metadata);
                const metadataItems = meta.itemTitles ?? [];
                const derivedItems = selectedAmazonTx.lineItems
                  .map((li) => li.description.replace(/^\[Amazon\]\s*/, ''))
                  .filter(Boolean);
                const itemsToShow = metadataItems.length > 0 ? metadataItems : derivedItems;
                const itemCount = meta.itemCount ?? itemsToShow.length;
                const isBusiness = selectedAmazonTx.classification !== 'PERSONAL';
                const hasIngestMatch = !!meta.orderId;
                const isPending = meta.matchStatus === 'pending';
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Transaction ID</p>
                        <p className="font-mono break-all">{selectedAmazonTx.id}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Amount</p>
                        <p className="font-semibold">
                          {formatCurrency(Number(selectedAmazonTx.amount))}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Transaction Date</p>
                        <p>{formatDate(selectedAmazonTx.date)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Account</p>
                        <p>{selectedAmazonTx.account?.name}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Business / Personal</p>
                        <p>{isBusiness ? 'Business' : 'Personal'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Ingest Match</p>
                        <p>{hasIngestMatch ? 'Yes' : 'No'}</p>
                      </div>
                      {meta.orderPlaced && (
                        <div>
                          <p className="text-muted-foreground">Order Date</p>
                          <p>{meta.orderPlaced}</p>
                        </div>
                      )}
                      {meta.dayDiff !== null && meta.dayDiff !== undefined && (
                        <div>
                          <p className="text-muted-foreground">Date Gap</p>
                          <p>{meta.dayDiff} day(s)</p>
                        </div>
                      )}
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm text-muted-foreground">Matched Bank Description</p>
                      <p className="font-medium">{selectedAmazonTx.description}</p>
                      {selectedAmazonTx.merchantName &&
                        selectedAmazonTx.merchantName !== selectedAmazonTx.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Merchant: {selectedAmazonTx.merchantName}
                          </p>
                        )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                          Order Contents ({itemCount} item{itemCount === 1 ? '' : 's'})
                        </p>
                        {meta.confidence && (
                          <Badge variant="outline" className="uppercase">
                            {meta.confidence}
                          </Badge>
                        )}
                      </div>
                      {itemsToShow.length === 0 ? (
                        <p className="text-sm text-muted-foreground mt-2">
                          No item list found for this order.
                        </p>
                      ) : (
                        <div className="mt-2 max-h-64 overflow-auto rounded-md border p-2 space-y-1">
                          {itemsToShow.map((item, idx) => (
                            <p key={`${idx}-${item.slice(0, 24)}`} className="text-sm">
                              {idx + 1}. {item}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Approval actions for pending matches */}
                    {isPending && (
                      <div className="flex items-center gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3">
                        <span className="text-sm font-medium text-yellow-800">Pending approval</span>
                        <div className="ml-auto flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={approveMatchMutation.isPending || rejectMatchMutation.isPending}
                            onClick={() => approveMatchMutation.mutate({ transactionId: selectedAmazonTxId! })}
                          >
                            {approveMatchMutation.isPending ? 'Approving...' : 'Approve'}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={approveMatchMutation.isPending || rejectMatchMutation.isPending}
                            onClick={() => rejectMatchMutation.mutate({ transactionId: selectedAmazonTxId! })}
                          >
                            {rejectMatchMutation.isPending ? 'Rejecting...' : 'Reject'}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button variant="outline" asChild>
                        <Link href={`/transactions?search=${encodeURIComponent(selectedAmazonTx.description)}`}>
                          Open in Transactions
                        </Link>
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Search opens by transaction description.
                      </p>
                    </div>
                  </div>
                );
              })()
            )}
          </DialogContent>
        </Dialog>

        {/* Venmo Match Detail Dialog */}
        <Dialog
          open={!!selectedVenmoTxId}
          onOpenChange={(open) => !open && setSelectedVenmoTxId(null)}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedVenmoTx
                  ? `Venmo Match${selectedVenmoMeta?.statementId ? ` - Statement ${selectedVenmoMeta.statementId}` : ''}`
                  : 'Venmo Match'}
              </DialogTitle>
              <DialogDescription>
                Review statement-linked Venmo details for this transaction
              </DialogDescription>
            </DialogHeader>
            {isSelectedVenmoTxLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : !selectedVenmoTx ? (
              <p className="text-sm text-muted-foreground">
                Matched transaction not found.
              </p>
            ) : (
              (() => {
                const meta = parseVenmoStatementMatchMeta(selectedVenmoTx.metadata);
                const isBusiness = selectedVenmoTx.classification !== 'PERSONAL';
                const hasStatementMatch = !!meta.statementId;
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Transaction ID</p>
                        <p className="font-mono break-all">{selectedVenmoTx.id}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Amount</p>
                        <p className="font-semibold">
                          {formatCurrency(Number(selectedVenmoTx.amount))}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Transaction Date</p>
                        <p>{formatDate(selectedVenmoTx.date)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Account</p>
                        <p>{selectedVenmoTx.account?.name}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Business / Personal</p>
                        <p>{isBusiness ? 'Business' : 'Personal'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Statement Match</p>
                        <p>{hasStatementMatch ? 'Yes' : 'No'}</p>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm text-muted-foreground">Bank Description</p>
                      <p className="font-medium">{selectedVenmoTx.description}</p>
                      {selectedVenmoTx.merchantName &&
                        selectedVenmoTx.merchantName !== selectedVenmoTx.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Merchant: {selectedVenmoTx.merchantName}
                          </p>
                        )}
                    </div>

                    {hasStatementMatch ? (
                      <div className="rounded-md border p-3 space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-muted-foreground">Statement Date/Time</p>
                            <p>{meta.statementDateTime ? formatDate(meta.statementDateTime) : '-'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Type / Status</p>
                            <p>{meta.type || '-'} / {meta.status || '-'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">From / To</p>
                            <p>{meta.from || '-'} / {meta.to || '-'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Confidence</p>
                            <p>{meta.confidence || '-'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Amount (total / fee)</p>
                            <p>
                              {typeof meta.amountTotalSigned === 'number'
                                ? formatCurrency(Math.abs(meta.amountTotalSigned))
                                : '-'}
                              {' / '}
                              {typeof meta.amountFeeSigned === 'number'
                                ? formatCurrency(Math.abs(meta.amountFeeSigned))
                                : '-'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Day Gap / Candidates</p>
                            <p>
                              {meta.dayDiff ?? '-'} / {meta.candidateCount ?? '-'}
                            </p>
                          </div>
                        </div>
                        {meta.note && (
                          <div>
                            <p className="text-muted-foreground">Note</p>
                            <p>{meta.note}</p>
                          </div>
                        )}
                        {meta.sourceFile && (
                          <div>
                            <p className="text-muted-foreground">Source File</p>
                            <p className="font-mono break-all">{meta.sourceFile}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No ingested Venmo statement match is attached to this transaction.
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <Button variant="outline" asChild>
                        <Link href={`/transactions?search=${encodeURIComponent(selectedVenmoTx.description)}`}>
                          Open in Transactions
                        </Link>
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Search opens by transaction description.
                      </p>
                    </div>
                  </div>
                );
              })()
            )}
          </DialogContent>
        </Dialog>

        {/* Receipt Detail Dialog */}
        <Dialog open={!!selectedReceipt} onOpenChange={(open) => !open && setSelectedReceipt(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedReceipt?.vendorName || selectedReceipt?.fileName}</DialogTitle>
              <DialogDescription>Receipt Details</DialogDescription>
            </DialogHeader>
            {selectedReceipt && (
              <div className="space-y-4">
                {selectedReceipt.fileUrl && selectedReceipt.fileType.includes('image') && (
                  <div className="rounded-lg overflow-hidden border">
                    <img
                      src={selectedReceipt.fileUrl}
                      alt="Receipt"
                      className="w-full h-auto max-h-64 object-contain"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {selectedReceipt.totalAmount && (
                    <div>
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="text-lg font-bold">{formatCurrency(Number(selectedReceipt.totalAmount))}</p>
                    </div>
                  )}
                  {selectedReceipt.receiptDate && (
                    <div>
                      <p className="text-sm text-muted-foreground">Receipt Date</p>
                      <p className="font-medium">{formatDate(selectedReceipt.receiptDate)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant="outline">{selectedReceipt.status}</Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Uploaded</p>
                    <p className="font-medium">{formatDate(selectedReceipt.createdAt)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Linked Transactions</p>
                  <p className="font-medium">
                    {selectedReceipt.transactionLinks.length > 0
                      ? `${selectedReceipt.transactionLinks.length} transaction(s)`
                      : 'Not linked to any transactions'}
                  </p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
