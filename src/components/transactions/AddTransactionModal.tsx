"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select-native";

interface AddTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultAccountId?: string;
}

const TRANSACTION_TYPES = [
  { value: "EXPENSE", label: "Expense" },
  { value: "INCOME", label: "Income" },
  { value: "TRANSFER", label: "Transfer" },
];

const CLASSIFICATIONS = [
  { value: "", label: "None" },
  { value: "INCOME", label: "Income" },
  { value: "COGS", label: "Cost of Goods Sold" },
  { value: "OPERATING", label: "Operating Expense" },
  { value: "PERSONAL", label: "Personal" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "REIMBURSABLE", label: "Reimbursable" },
];

export function AddTransactionModal({
  open,
  onOpenChange,
  onSuccess,
  defaultAccountId,
}: AddTransactionModalProps) {
  const [accountId, setAccountId] = useState(defaultAccountId || "");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<string>("EXPENSE");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [classification, setClassification] = useState("");
  const [payerId, setPayerId] = useState("");
  const [incurredById, setIncurredById] = useState("");
  const [notes, setNotes] = useState("");

  const utils = api.useUtils();
  const { data: accounts } = api.accounts.list.useQuery();
  const { data: categories } = api.categories.list.useQuery();
  const { data: entities } = api.entities.list.useQuery();

  const createMutation = api.transactions.create.useMutation({
    onSuccess: () => {
      utils.transactions.invalidate();
      utils.accounts.invalidate();
      utils.dashboard.invalidate();
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    },
  });

  const resetForm = () => {
    setAccountId(defaultAccountId || "");
    setAmount("");
    setType("EXPENSE");
    setDate(new Date().toISOString().split("T")[0]);
    setDescription("");
    setMerchantName("");
    setCategoryId("");
    setClassification("");
    setPayerId("");
    setIncurredById("");
    setNotes("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount)) return;

    createMutation.mutate({
      accountId,
      amount: parsedAmount,
      type: type as 'INCOME' | 'EXPENSE' | 'TRANSFER',
      status: "POSTED",
      date: new Date(date),
      description,
      merchantName: merchantName || undefined,
      categoryId: categoryId || undefined,
      classification: (classification || undefined) as 'INCOME' | 'REIMBURSEMENT' | 'COGS' | 'OPERATING' | 'PERSONAL' | 'TRANSFER' | 'REIMBURSABLE' | undefined,
      payerId: payerId || undefined,
      incurredById: incurredById || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogClose onClick={() => onOpenChange(false)} />
        <DialogHeader>
          <DialogTitle>Add New Transaction</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="account">Account *</Label>
              <Select
                id="account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">Select account</option>
                {accounts?.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this transaction for?"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="merchantName">Merchant Name</Label>
              <Input
                id="merchantName"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder="e.g., Amazon, Starbucks"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                id="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Uncategorized</option>
                {categories?.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="classification">Classification</Label>
              <Select
                id="classification"
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payer">Paid By</Label>
              <Select
                id="payer"
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
              >
                <option value="">Not specified</option>
                {entities?.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="incurredBy">Incurred By</Label>
              <Select
                id="incurredBy"
                value={incurredById}
                onChange={(e) => setIncurredById(e.target.value)}
              >
                <option value="">Not specified</option>
                {entities?.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
            />
          </div>

          <DialogFooter className="p-0 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
