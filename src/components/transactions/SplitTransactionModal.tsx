'use client';

import { useState, useEffect } from 'react';
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
import { formatCurrency } from '@/lib/utils';
import { Plus, Trash2, Scissors } from 'lucide-react';

interface SplitTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  transactionAmount: number;
  onSuccess?: () => void;
}

interface SplitRow {
  amount: string;
  categoryId: string;
  classification: string;
  description: string;
}

const CLASSIFICATIONS = [
  { value: '', label: 'None' },
  { value: 'INCOME', label: 'Income' },
  { value: 'COGS', label: 'COGS' },
  { value: 'OPERATING', label: 'Operating' },
  { value: 'PERSONAL', label: 'Personal' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'REIMBURSABLE', label: 'Reimbursable' },
];

export function SplitTransactionModal({
  open,
  onOpenChange,
  transactionId,
  transactionAmount,
  onSuccess,
}: SplitTransactionModalProps) {
  const absAmount = Math.abs(transactionAmount);
  const utils = api.useContext();
  const { data: categories } = api.categories.list.useQuery();

  // Load existing splits
  const { data: existingSplits } = api.splits.getByTransactionId.useQuery(
    { transactionId },
    { enabled: open }
  );

  const [rows, setRows] = useState<SplitRow[]>([
    { amount: '', categoryId: '', classification: '', description: '' },
    { amount: '', categoryId: '', classification: '', description: '' },
  ]);

  // Populate from existing splits when data loads
  useEffect(() => {
    if (existingSplits && existingSplits.splits.length >= 2) {
      setRows(
        existingSplits.splits.map((s) => ({
          amount: Math.abs(Number(s.amount)).toFixed(2),
          categoryId: s.category?.id || '',
          classification: (s.classification as string) || '',
          description: s.description || '',
        }))
      );
    } else {
      // Default: two empty rows
      setRows([
        { amount: (absAmount / 2).toFixed(2), categoryId: '', classification: '', description: '' },
        { amount: (absAmount / 2).toFixed(2), categoryId: '', classification: '', description: '' },
      ]);
    }
  }, [existingSplits, absAmount]);

  const saveMutation = api.splits.save.useMutation(
    useToastCallbacks({
      successTitle: 'Splits Saved',
      successDescription: 'Transaction has been split successfully',
      errorTitle: 'Failed to save splits',
    })
  );

  const removeMutation = api.splits.remove.useMutation(
    useToastCallbacks({
      successTitle: 'Splits Removed',
      successDescription: 'Transaction splits have been removed',
      errorTitle: 'Failed to remove splits',
    })
  );

  const totalAllocated = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const remaining = absAmount - totalAllocated;

  const addRow = () => {
    setRows([...rows, { amount: remaining > 0 ? remaining.toFixed(2) : '', categoryId: '', classification: '', description: '' }]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 2) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof SplitRow, value: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleSave = async () => {
    await saveMutation.mutateAsync({
      transactionId,
      splits: rows.map((r) => ({
        amount: parseFloat(r.amount) || 0,
        categoryId: r.categoryId || undefined,
        classification: (r.classification || undefined) as any,
        description: r.description || undefined,
      })),
    });

    await utils.splits.getByTransactionId.invalidate({ transactionId });
    await utils.transactions.invalidate();
    onSuccess?.();
    onOpenChange(false);
  };

  const handleRemoveSplits = async () => {
    await removeMutation.mutateAsync({ transactionId });
    await utils.splits.getByTransactionId.invalidate({ transactionId });
    await utils.transactions.invalidate();
    onSuccess?.();
    onOpenChange(false);
  };

  const isValid = rows.length >= 2 && Math.abs(remaining) < 0.02 && rows.every((r) => parseFloat(r.amount) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
          <DialogDescription>
            Split {formatCurrency(absAmount)} into multiple categories or classifications.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Summary bar */}
          <div className="flex items-center justify-between text-sm bg-muted p-3 rounded-md">
            <span>Total: {formatCurrency(absAmount)}</span>
            <span>Allocated: {formatCurrency(totalAllocated)}</span>
            <span className={Math.abs(remaining) < 0.02 ? 'text-green-600' : 'text-red-600'}>
              Remaining: {formatCurrency(remaining)}
            </span>
          </div>

          {/* Split rows */}
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-2">
                  {index === 0 && <Label className="text-xs">Amount</Label>}
                  <Input
                    type="number"
                    step="0.01"
                    value={row.amount}
                    onChange={(e) => updateRow(index, 'amount', e.target.value)}
                    placeholder="0.00"
                    className="h-9"
                  />
                </div>
                <div className="col-span-3">
                  {index === 0 && <Label className="text-xs">Category</Label>}
                  <Select
                    value={row.categoryId || '_none'}
                    onValueChange={(v) => updateRow(index, 'categoryId', v === '_none' ? '' : v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {categories?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.icon} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  {index === 0 && <Label className="text-xs">Classification</Label>}
                  <Select
                    value={row.classification || '_none'}
                    onValueChange={(v) => updateRow(index, 'classification', v === '_none' ? '' : v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLASSIFICATIONS.map((c) => (
                        <SelectItem key={c.value || '_none'} value={c.value || '_none'}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  {index === 0 && <Label className="text-xs">Description</Label>}
                  <Input
                    value={row.description}
                    onChange={(e) => updateRow(index, 'description', e.target.value)}
                    placeholder="Note..."
                    className="h-9"
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => removeRow(index)}
                    disabled={rows.length <= 2}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-2" />
            Add Split
          </Button>
        </div>

        <DialogFooter className="flex justify-between">
          <div>
            {existingSplits && existingSplits.splits.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemoveSplits}
                disabled={removeMutation.isLoading}
              >
                Remove Splits
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isValid || saveMutation.isLoading}
            >
              <Scissors className="h-4 w-4 mr-2" />
              Save Splits
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
