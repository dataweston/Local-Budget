'use client';

import { useState } from 'react';
import { api } from '@/lib/trpc';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { Search, Store, TrendingUp, AlertTriangle, Merge } from 'lucide-react';
import { useToastCallbacks } from '@/hooks/use-toast-mutation';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function VendorsPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'spending' | 'count'>('spending');
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeGroup, setMergeGroup] = useState<string[]>([]);
  const [targetName, setTargetName] = useState('');
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const utils = api.useContext();

  // Fetch vendors list
  const { data: vendorsData, isLoading } = api.vendors.list.useQuery({
    search,
    sortBy,
    limit: 100,
  });

  // Fetch duplicates
  const { data: duplicates } = api.vendors.findDuplicates.useQuery({
    threshold: 0.8,
  });

  // Fetch selected vendor details
  const { data: vendorDetails } = api.vendors.getByName.useQuery(
    { name: selectedVendor! },
    { enabled: !!selectedVendor }
  );

  // Merge mutation
  const mergeMutation = api.vendors.merge.useMutation(
    useToastCallbacks({
      successTitle: 'Vendors Merged',
      successDescription: 'Vendor names have been consolidated',
      errorTitle: 'Failed to merge vendors',
    })
  );

  const handleMerge = async () => {
    if (mergeGroup.length < 2 || !targetName) return;

    try {
      await mergeMutation.mutateAsync({
        sourceNames: mergeGroup,
        targetName,
      });
    } finally {
      setMergeModalOpen(false);
      setMergeGroup([]);
      setTargetName('');
      setSelectedVendor(null);
      setMergeSelection(new Set());
      setSelectMode(false);

      // Always refresh data
      await utils.vendors.list.invalidate();
      await utils.vendors.findDuplicates.invalidate();
      await utils.vendors.getByName.invalidate();
    }
  };

  const toggleMergeSelect = (name: string) => {
    setMergeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const openMergeFromSelection = () => {
    const names = Array.from(mergeSelection);
    if (names.length < 2) return;
    setMergeGroup(names);
    setTargetName(names[0]);
    setMergeModalOpen(true);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Vendors</h1>
        <p className="text-muted-foreground">
          View and manage your spending by vendor
        </p>
      </div>

      {/* Duplicate Detection Alert */}
      {duplicates && duplicates.length > 0 && (
        <Card className="mb-6 border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-900">
              <AlertTriangle className="h-5 w-5" />
              Potential Duplicates Detected
            </CardTitle>
            <CardDescription className="text-orange-700">
              We found {duplicates.length} group(s) of similar vendor names that might be duplicates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {duplicates.slice(0, 3).map((group, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-white p-3 rounded-md"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {group.group.join(', ')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {Math.round(group.similarity * 100)}% similar
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMergeGroup(group.group);
                      setTargetName(group.group[0]);
                      setMergeModalOpen(true);
                    }}
                  >
                    <Merge className="h-4 w-4 mr-2" />
                    Merge
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vendor List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Vendors</CardTitle>
                <CardDescription>
                  {vendorsData?.total || 0} unique vendors
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant={selectMode ? 'default' : 'outline'}
                onClick={() => {
                  setSelectMode(!selectMode);
                  setMergeSelection(new Set());
                }}
              >
                <Merge className="h-4 w-4 mr-1" />
                {selectMode ? 'Cancel' : 'Merge'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Merge selection bar */}
            {selectMode && mergeSelection.size >= 2 && (
              <div className="mb-3 p-3 bg-accent rounded-md flex items-center justify-between">
                <span className="text-sm font-medium">
                  {mergeSelection.size} vendors selected
                </span>
                <Button size="sm" onClick={openMergeFromSelection}>
                  <Merge className="h-4 w-4 mr-1" />
                  Merge Selected
                </Button>
              </div>
            )}

            {/* Search and Sort */}
            <div className="space-y-3 mb-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search vendors..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select
                value={sortBy}
                onValueChange={(value: string) => setSortBy(value as typeof sortBy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spending">Sort by Spending</SelectItem>
                  <SelectItem value="count">Sort by Transactions</SelectItem>
                  <SelectItem value="name">Sort by Name</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Vendor List */}
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {isLoading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : vendorsData?.vendors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No vendors found
                </div>
              ) : (
                vendorsData?.vendors.map((vendor) => (
                  <button
                    key={vendor.name}
                    onClick={() => {
                      if (selectMode) {
                        toggleMergeSelect(vendor.name);
                      } else {
                        setSelectedVendor(vendor.name);
                      }
                    }}
                    className={`w-full p-3 rounded-md border text-left transition-colors ${
                      selectMode && mergeSelection.has(vendor.name)
                        ? 'bg-primary/10 border-primary'
                        : selectedVendor === vendor.name
                        ? 'bg-accent border-primary'
                        : 'hover:bg-accent'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {selectMode && (
                          <div className={`mt-1 h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center ${
                            mergeSelection.has(vendor.name)
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground'
                          }`}>
                            {mergeSelection.has(vendor.name) && (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{vendor.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {vendor.count} transaction{vendor.count !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {formatCurrency(vendor.totalSpending)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Vendor Details */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedVendor ? (
            <Card className="h-[400px] flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Store className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a vendor to view details</p>
              </div>
            </Card>
          ) : vendorDetails ? (
            <>
              {/* Vendor Stats */}
              <Card>
                <CardHeader>
                  <CardTitle>{vendorDetails.name}</CardTitle>
                  <CardDescription>
                    {vendorDetails.stats.transactionCount} transactions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Spending</div>
                      <div className="text-2xl font-bold">
                        {formatCurrency(vendorDetails.stats.totalSpending)}
                      </div>
                    </div>
                    {vendorDetails.stats.totalIncome > 0 && (
                      <div>
                        <div className="text-sm text-muted-foreground">Total Income</div>
                        <div className="text-2xl font-bold text-green-600">
                          {formatCurrency(vendorDetails.stats.totalIncome)}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Spending Trend */}
              {vendorDetails.stats.monthlyTrend.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Spending Trend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={vendorDetails.stats.monthlyTrend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Area
                          type="monotone"
                          dataKey="amount"
                          stroke="#8884d8"
                          fill="#8884d8"
                          fillOpacity={0.3}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Category Breakdown */}
              {vendorDetails.stats.categoryBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Category Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {vendorDetails.stats.categoryBreakdown.map((cat) => (
                        <div key={cat.name} className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{cat.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {cat.count} transaction{cat.count !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <div className="font-medium">
                            {formatCurrency(cat.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent Transactions */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {vendorDetails.transactions.slice(0, 10).map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{tx.description}</div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(tx.date).toLocaleDateString()} • {tx.account.name}
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`font-medium ${
                              tx.type === 'INCOME' ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatCurrency(tx.amount)}
                          </div>
                          {tx.category && (
                            <div className="text-xs text-muted-foreground">
                              {tx.category.name}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="h-[400px] flex items-center justify-center">
              <Skeleton className="h-32 w-full max-w-md" />
            </Card>
          )}
        </div>
      </div>

      {/* Merge Modal */}
      <Dialog open={mergeModalOpen} onOpenChange={setMergeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Vendors</DialogTitle>
            <DialogDescription>
              Consolidate similar vendor names into one canonical name
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Vendors to Merge</Label>
              <div className="text-sm text-muted-foreground">
                {mergeGroup.join(', ')}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetName">Target Name</Label>
              <Input
                id="targetName"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Enter the canonical vendor name"
              />
              <p className="text-xs text-muted-foreground">
                All transactions will be updated to use this name
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergeModalOpen(false)}
              disabled={mergeMutation.isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!targetName || mergeMutation.isLoading}
            >
              <Merge className="h-4 w-4 mr-2" />
              Merge Vendors
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </main>
    </div>
  );
}
