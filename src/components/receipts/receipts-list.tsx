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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  Upload,
  FileText,
  Link2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Image,
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

const statusConfig = {
  PENDING: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  PROCESSING: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
  PROCESSED: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  FAILED: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  REVIEWED: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
};

export function ReceiptsList() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);

  const { data, isLoading, refetch } = api.receipts.list.useQuery({
    status: statusFilter as any,
  });

  const { data: pendingCount } = api.receipts.pendingCount.useQuery();
  const { data: unlinkedReceipts } = api.receipts.unlinked.useQuery();

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
                              <Image className="h-6 w-6 text-muted-foreground" />
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
