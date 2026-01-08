'use client';

import { useState } from 'react';
import { api } from '@/lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToastCallbacks } from '@/hooks/use-toast-mutation';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Link2 } from 'lucide-react';

interface LinkTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  onSuccess?: () => void;
}

export function LinkTransactionModal({
  open,
  onOpenChange,
  transactionId,
  onSuccess,
}: LinkTransactionModalProps) {
  const [linkType, setLinkType] = useState<'REIMBURSEMENT' | 'TRANSFER' | 'REFUND' | 'RELATED'>('RELATED');
  const [selectedTransactionId, setSelectedTransactionId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const utils = api.useContext();

  // Get candidates
  const { data: candidates, isLoading } = api.transactionLinks.findCandidates.useQuery(
    { transactionId, maxResults: 20 },
    { enabled: open }
  );

  // Create link mutation
  const createLink = api.transactionLinks.create.useMutation(
    useToastCallbacks({
      successTitle: 'Link Created',
      successDescription: 'Transactions have been linked successfully',
      errorTitle: 'Failed to create link',
    })
  );

  const handleSubmit = async () => {
    if (!selectedTransactionId) return;

    await createLink.mutateAsync({
      fromId: transactionId,
      toId: selectedTransactionId,
      linkType,
      notes: notes || undefined,
    });

    // Reset form
    setSelectedTransactionId('');
    setNotes('');
    setSearchTerm('');
    
    // Invalidate queries
    await utils.transactionLinks.getByTransactionId.invalidate({ transactionId });
    
    onSuccess?.();
    onOpenChange(false);
  };

  // Filter candidates by search term
  const filteredCandidates = candidates?.filter((c) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      c.description.toLowerCase().includes(search) ||
      c.merchantName?.toLowerCase().includes(search) ||
      c.account.name.toLowerCase().includes(search)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Link Transaction</DialogTitle>
          <DialogDescription>
            Link this transaction to another related transaction (e.g., reimbursement, transfer, refund).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Link Type */}
          <div className="space-y-2">
            <Label htmlFor="linkType">Link Type</Label>
            <Select
              value={linkType}
              onValueChange={(value) => setLinkType(value as typeof linkType)}
            >
              <SelectTrigger id="linkType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RELATED">Related</SelectItem>
                <SelectItem value="REIMBURSEMENT">Reimbursement</SelectItem>
                <SelectItem value="TRANSFER">Transfer</SelectItem>
                <SelectItem value="REFUND">Refund</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <Label htmlFor="search">Search Transactions</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Search by description, merchant, or account..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          {/* Suggested Matches */}
          <div className="space-y-2">
            <Label>Suggested Matches</Label>
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : filteredCandidates && filteredCandidates.length > 0 ? (
                <div className="divide-y">
                  {filteredCandidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      onClick={() => setSelectedTransactionId(candidate.id)}
                      className={`w-full p-3 text-left hover:bg-accent transition-colors ${
                        selectedTransactionId === candidate.id ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {candidate.merchantName || candidate.description}
                          </div>
                          <div className="text-sm text-muted-foreground truncate">
                            {candidate.account.name} • {formatDate(candidate.date)}
                          </div>
                          {candidate.category && (
                            <div className="text-xs text-muted-foreground">
                              {candidate.category.name}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className={`font-medium ${
                            candidate.type === 'INCOME' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {formatCurrency(candidate.amount)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {Math.round((candidate.matchScore || 0) * 100)}% match
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  No matching transactions found
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Input
              id="notes"
              placeholder="Add any additional notes about this link..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createLink.isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedTransactionId || createLink.isLoading}
          >
            <Link2 className="h-4 w-4 mr-2" />
            Create Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
