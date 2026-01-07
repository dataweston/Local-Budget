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
import { Plus, Pencil, Trash2 } from 'lucide-react';

type ClassificationType = 'INCOME' | 'COGS' | 'OPERATING' | 'PERSONAL' | 'TRANSFER' | 'REIMBURSABLE' | 'REIMBURSEMENT';

interface CategoryFormData {
  name: string;
  color: string;
  icon: string;
  defaultClassification: ClassificationType | '';
}

const colorOptions = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#6b7280', label: 'Gray' },
];

const classificationOptions = [
  { value: '', label: 'No default' },
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

export default function CategoriesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{ id: string } & CategoryFormData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formData, setFormData] = useState<CategoryFormData>({
    name: '',
    color: '#3b82f6',
    icon: '',
    defaultClassification: '',
  });

  const utils = api.useUtils();
  const { data: categories, isLoading } = api.categories.list.useQuery();

  const createMutation = api.categories.create.useMutation({
    onSuccess: () => {
      utils.categories.list.invalidate();
      setShowAddModal(false);
      setFormData({ name: '', color: '#3b82f6', icon: '', defaultClassification: '' });
    },
  });

  const updateMutation = api.categories.update.useMutation({
    onSuccess: () => {
      utils.categories.list.invalidate();
      setEditingCategory(null);
      setFormData({ name: '', color: '#3b82f6', icon: '', defaultClassification: '' });
    },
  });

  const deleteMutation = api.categories.delete.useMutation({
    onSuccess: () => {
      utils.categories.list.invalidate();
      setDeleteConfirm(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: formData.name,
      color: formData.color,
      icon: formData.icon || undefined,
      defaultClassification: formData.defaultClassification || undefined,
    };
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEditModal = (category: { 
    id: string; 
    name: string; 
    color: string | null; 
    icon: string | null;
    defaultClassification: ClassificationType | null;
  }) => {
    setFormData({
      name: category.name,
      color: category.color || '#3b82f6',
      icon: category.icon || '',
      defaultClassification: category.defaultClassification || '',
    });
    setEditingCategory({
      id: category.id,
      name: category.name,
      color: category.color || '#3b82f6',
      icon: category.icon || '',
      defaultClassification: category.defaultClassification || '',
    });
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingCategory(null);
    setFormData({ name: '', color: '#3b82f6', icon: '', defaultClassification: '' });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Categories</h1>
            <p className="text-muted-foreground">
              Organize your transactions with custom categories
            </p>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Categories</CardTitle>
            <CardDescription>
              {categories?.length ?? 0} categories defined
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {categories?.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: category.color || '#3b82f6' }}
                      />
                      <span className="font-medium">{category.name}</span>
                      {category.icon && <span className="text-lg">{category.icon}</span>}
                      {category.defaultClassification && (
                        <Badge className={classificationColors[category.defaultClassification] || 'bg-gray-100'}>
                          {category.defaultClassification}
                        </Badge>
                      )}
                      <span className="text-sm text-muted-foreground">
                        ({category._count.transactions} transactions)
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditModal(category as any)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setDeleteConfirm(category.id)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {categories?.length === 0 && (
                  <p className="text-center py-4 text-muted-foreground text-sm">
                    No categories yet. Add your first category to organize transactions.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Add/Edit Modal */}
      <Dialog open={showAddModal || !!editingCategory} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Add Category'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Category name"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Icon (emoji)</label>
                <Input
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="e.g., 🛒, 🍽️, 🚗"
                  maxLength={10}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Default Classification</label>
                <Select
                  value={formData.defaultClassification}
                  onChange={(e) => setFormData({ ...formData, defaultClassification: e.target.value as ClassificationType | '' })}
                >
                  {classificationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  When a transaction uses this category, this classification will be auto-applied
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Color</label>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        formData.color === color.value ? 'border-foreground scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingCategory ? 'Save Changes' : 'Add Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
          </DialogHeader>
          <p className="py-4">
            Are you sure you want to delete this category? Transactions using this category
            will need to be recategorized.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
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
    </div>
  );
}
