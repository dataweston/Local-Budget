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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  Pause,
  Wand2,
  TestTube,
  Lightbulb,
  ChevronRight,
} from 'lucide-react';

type MatchType = 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'REGEX';
type ClassificationType = 'INCOME' | 'COGS' | 'OPERATING' | 'PERSONAL' | 'TRANSFER' | 'REIMBURSABLE' | 'REIMBURSEMENT';

interface RuleFormData {
  name: string;
  matchField: string;
  matchType: MatchType;
  matchValue: string;
  categoryId: string;
  classification: ClassificationType | '';
  priority: number;
}

const matchFieldOptions = [
  { value: 'merchantName', label: 'Merchant Name' },
  { value: 'description', label: 'Description' },
];

const matchTypeOptions = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EXACT', label: 'Exact Match' },
  { value: 'STARTS_WITH', label: 'Starts With' },
  { value: 'REGEX', label: 'Regex Pattern' },
];

const classificationOptions = [
  { value: '', label: 'No classification' },
  { value: 'INCOME', label: 'Income' },
  { value: 'COGS', label: 'Cost of Goods Sold' },
  { value: 'OPERATING', label: 'Operating Expense' },
  { value: 'PERSONAL', label: 'Personal' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'REIMBURSABLE', label: 'Reimbursable' },
  { value: 'REIMBURSEMENT', label: 'Reimbursement' },
];

const classificationColors: Record<string, string> = {
  INCOME: 'bg-green-100 text-green-800',
  COGS: 'bg-orange-100 text-orange-800',
  OPERATING: 'bg-blue-100 text-blue-800',
  PERSONAL: 'bg-purple-100 text-purple-800',
  TRANSFER: 'bg-gray-100 text-gray-800',
  REIMBURSABLE: 'bg-yellow-100 text-yellow-800',
  REIMBURSEMENT: 'bg-teal-100 text-teal-800',
};

const matchTypeLabels: Record<string, string> = {
  EXACT: 'Exact',
  CONTAINS: 'Contains',
  STARTS_WITH: 'Starts with',
  REGEX: 'Regex',
};

const defaultFormData: RuleFormData = {
  name: '',
  matchField: 'merchantName',
  matchType: 'CONTAINS',
  matchValue: '',
  categoryId: '',
  classification: '',
  priority: 0,
};

export default function RulesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRule, setEditingRule] = useState<{ id: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);
  const [formData, setFormData] = useState<RuleFormData>(defaultFormData);
  const [testResults, setTestResults] = useState<{ matches: Array<{ id: string; description: string; merchantName: string | null; date: Date }>; totalChecked: number } | null>(null);

  const utils = api.useUtils();
  const { data: rules, isLoading } = api.rules.list.useQuery();
  const { data: categories } = api.categories.list.useQuery();
  const { data: suggestions } = api.rules.suggest.useQuery(undefined, {
    enabled: showSuggestionsModal,
  });

  const createMutation = api.rules.create.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate();
      setShowAddModal(false);
      setFormData(defaultFormData);
    },
  });

  const updateMutation = api.rules.update.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate();
      setEditingRule(null);
      setFormData(defaultFormData);
    },
  });

  const deleteMutation = api.rules.delete.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate();
      setDeleteConfirm(null);
    },
  });

  const toggleActiveMutation = api.rules.toggleActive.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate();
    },
  });

  const applyRulesMutation = api.rules.applyRules.useMutation({
    onSuccess: (data) => {
      utils.transactions.list.invalidate();
      alert(`Applied rules: ${data.updated} transactions updated`);
    },
  });

  const testQuery = api.rules.test.useQuery(
    {
      matchField: formData.matchField,
      matchType: formData.matchType,
      matchValue: formData.matchValue,
      limit: 10,
    },
    {
      enabled: showTestModal && formData.matchValue.length > 0,
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: formData.name,
      matchField: formData.matchField,
      matchType: formData.matchType,
      matchValue: formData.matchValue,
      categoryId: formData.categoryId || undefined,
      classification: formData.classification || undefined,
      priority: formData.priority,
    };
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEditModal = (rule: {
    id: string;
    name: string;
    matchField: string;
    matchType: MatchType;
    matchValue: string;
    categoryId: string | null;
    classification: ClassificationType | null;
    priority: number;
  }) => {
    setFormData({
      name: rule.name,
      matchField: rule.matchField,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
      categoryId: rule.categoryId || '',
      classification: rule.classification || '',
      priority: rule.priority,
    });
    setEditingRule({ id: rule.id });
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingRule(null);
    setFormData(defaultFormData);
  };

  const createRuleFromSuggestion = (suggestion: { merchantName: string; suggestedCategoryId?: string }) => {
    setFormData({
      ...defaultFormData,
      name: `Auto: ${suggestion.merchantName}`,
      matchField: 'merchantName',
      matchType: 'CONTAINS',
      matchValue: suggestion.merchantName,
      categoryId: suggestion.suggestedCategoryId || '',
    });
    setShowSuggestionsModal(false);
    setShowAddModal(true);
  };

  const categoryOptions = [
    { value: '', label: 'No category' },
    ...(categories?.map((c) => ({ value: c.id, label: c.name })) || []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto py-6 px-4">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Classification Rules</h1>
            <p className="text-muted-foreground">
              Auto-categorize transactions based on patterns
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowSuggestionsModal(true)}
              className="gap-2"
            >
              <Lightbulb className="h-4 w-4" />
              Suggestions
            </Button>
            <Button
              variant="outline"
              onClick={() => applyRulesMutation.mutate()}
              disabled={applyRulesMutation.isPending}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Apply Rules
            </Button>
            <Button onClick={() => setShowAddModal(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your Rules</CardTitle>
            <CardDescription>
              Rules are applied in priority order (highest first). First matching rule wins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : rules?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Wand2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No rules yet. Create one to start auto-categorizing.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rules?.map((rule) => (
                  <div
                    key={rule.id}
                    className={`flex items-center justify-between p-4 border rounded-lg ${
                      rule.isActive ? 'bg-background' : 'bg-muted/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => toggleActiveMutation.mutate({ id: rule.id })}
                        className="p-1 hover:bg-accent rounded"
                        title={rule.isActive ? 'Disable rule' : 'Enable rule'}
                      >
                        {rule.isActive ? (
                          <Play className="h-5 w-5 text-green-600" />
                        ) : (
                          <Pause className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {rule.name}
                          <Badge variant="outline" className="text-xs">
                            Priority: {rule.priority}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1">
                          <span className="capitalize">{rule.matchField}</span>
                          <ChevronRight className="h-3 w-3" />
                          <span>{matchTypeLabels[rule.matchType]}</span>
                          <ChevronRight className="h-3 w-3" />
                          <code className="bg-muted px-1 rounded">{rule.matchValue}</code>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {rule.category && (
                          <Badge
                            style={{ backgroundColor: rule.category.color || undefined }}
                            className="mb-1"
                          >
                            {rule.category.name}
                          </Badge>
                        )}
                        {rule.classification && (
                          <Badge className={classificationColors[rule.classification]}>
                            {rule.classification}
                          </Badge>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          Applied {rule.timesApplied}x
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditModal(rule as Parameters<typeof openEditModal>[0])}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirm(rule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add/Edit Rule Modal */}
        <Dialog open={showAddModal || !!editingRule} onOpenChange={closeModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingRule ? 'Edit Rule' : 'Add Rule'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Rule Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Amazon Purchases"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Match Field</label>
                  <Select
                    value={formData.matchField}
                    onChange={(e) => setFormData({ ...formData, matchField: e.target.value })}
                  >
                    {matchFieldOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Match Type</label>
                  <Select
                    value={formData.matchType}
                    onChange={(e) => setFormData({ ...formData, matchType: e.target.value as MatchType })}
                  >
                    {matchTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Match Value</label>
                <div className="flex gap-2">
                  <Input
                    value={formData.matchValue}
                    onChange={(e) => setFormData({ ...formData, matchValue: e.target.value })}
                    placeholder={formData.matchType === 'REGEX' ? '^amazon.*' : 'amazon'}
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowTestModal(true)}
                    disabled={!formData.matchValue}
                  >
                    <TestTube className="h-4 w-4" />
                  </Button>
                </div>
                {formData.matchType === 'REGEX' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Use regex pattern (case-insensitive)
                  </p>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-3">Actions (when rule matches)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Assign Category</label>
                    <Select
                      value={formData.categoryId}
                      onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                    >
                      {categoryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Classification</label>
                    <Select
                      value={formData.classification}
                      onChange={(e) => setFormData({ ...formData, classification: e.target.value as ClassificationType | '' })}
                    >
                      {classificationOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Priority</label>
                <Input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Higher priority rules are checked first
                </p>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editingRule ? 'Save Changes' : 'Create Rule'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Test Rule Modal */}
        <Dialog open={showTestModal} onOpenChange={setShowTestModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Rule Pattern</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-4">
                Showing transactions that match: <code className="bg-muted px-1 rounded">{formData.matchValue}</code>
              </p>
              {testQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : testQuery.data?.matches.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground">
                  No matching transactions found
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-auto">
                  {testQuery.data?.matches.map((tx) => (
                    <div key={tx.id} className="p-2 border rounded text-sm">
                      <div className="font-medium">{tx.merchantName || tx.description}</div>
                      <div className="text-muted-foreground text-xs">
                        {tx.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-4">
                Checked {testQuery.data?.totalChecked || 0} recent transactions
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setShowTestModal(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Suggestions Modal */}
        <Dialog open={showSuggestionsModal} onOpenChange={setShowSuggestionsModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Rule Suggestions</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-4">
                Based on your uncategorized transactions, consider creating rules for:
              </p>
              {!suggestions || suggestions.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No suggestions available. Categorize some transactions first!
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-auto">
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 border rounded hover:bg-accent cursor-pointer"
                      onClick={() => createRuleFromSuggestion(s)}
                    >
                      <div>
                        <div className="font-medium">{s.merchantName}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.occurrences} uncategorized transactions
                        </div>
                      </div>
                      {s.suggestedCategoryName && (
                        <Badge variant="outline">{s.suggestedCategoryName}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSuggestionsModal(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Modal */}
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Rule</DialogTitle>
            </DialogHeader>
            <p>Are you sure you want to delete this rule? This action cannot be undone.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirm && deleteMutation.mutate({ id: deleteConfirm })}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
