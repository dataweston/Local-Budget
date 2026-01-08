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

interface AddAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const ACCOUNT_TYPES = [
  { value: "CHECKING", label: "Checking" },
  { value: "SAVINGS", label: "Savings" },
  { value: "CREDIT_CARD", label: "Credit Card" },
  { value: "CASH", label: "Cash" },
  { value: "INVESTMENT", label: "Investment" },
  { value: "LOAN", label: "Loan" },
  { value: "OTHER", label: "Other" },
];

export function AddAccountModal({
  open,
  onOpenChange,
  onSuccess,
}: AddAccountModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("CHECKING");
  const [institution, setInstitution] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [currentBalance, setCurrentBalance] = useState("");
  const [entityId, setEntityId] = useState<string>("");
  const [currency, setCurrency] = useState("USD");

  const utils = api.useUtils();
  const { data: entities } = api.entities.list.useQuery();

  const createMutation = api.accounts.create.useMutation({
    onSuccess: () => {
      utils.accounts.invalidate();
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    },
  });

  const resetForm = () => {
    setName("");
    setType("CHECKING");
    setInstitution("");
    setAccountNumber("");
    setCurrentBalance("");
    setEntityId("");
    setCurrency("USD");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      type: type as any,
      institution: institution || undefined,
      accountNumber: accountNumber || undefined,
      currentBalance: currentBalance ? parseFloat(currentBalance) : 0,
      entityId: entityId || undefined,
      currency,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogClose onClick={() => onOpenChange(false)} />
        <DialogHeader>
          <DialogTitle>Add New Account</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Account Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Main Checking"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Account Type *</Label>
              <Select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="institution">Institution</Label>
            <Input
              id="institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="e.g., Chase Bank"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="accountNumber">Last 4 Digits</Label>
              <Input
                id="accountNumber"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.slice(0, 4))}
                placeholder="1234"
                maxLength={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currentBalance">Starting Balance</Label>
              <Input
                id="currentBalance"
                type="number"
                step="0.01"
                value={currentBalance}
                onChange={(e) => setCurrentBalance(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entity">Entity (Optional)</Label>
            <Select
              id="entity"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">No entity</option>
              {entities?.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name} ({entity.type})
                </option>
              ))}
            </Select>
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
              {createMutation.isPending ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
