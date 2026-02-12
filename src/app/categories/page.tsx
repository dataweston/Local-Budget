'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
import { Select } from '@/components/ui/select-native';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';

type ClassificationType =
  | 'INCOME'
  | 'COGS'
  | 'OPERATING'
  | 'PERSONAL'
  | 'TRANSFER'
  | 'REIMBURSABLE'
  | 'REIMBURSEMENT';

type CategoryNode = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  defaultClassification: ClassificationType | null;
  _count?: { transactions: number };
  children?: CategoryNode[];
};

interface CategoryFormData {
  name: string;
  color: string;
  icon: string;
  defaultClassification: ClassificationType | '';
  parentId: string;
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

const EMPTY_FORM: CategoryFormData = {
  name: '',
  color: '#3b82f6',
  icon: '',
  defaultClassification: '',
  parentId: '',
};

export default function CategoriesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{ id: string } & CategoryFormData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formData, setFormData] = useState<CategoryFormData>(EMPTY_FORM);

  const utils = api.useUtils();
  const { data: categories, isLoading: listLoading } = api.categories.list.useQuery();
  const { data: categoryTree, isLoading: treeLoading } = api.categories.tree.useQuery();

  const invalidateCategoryData = async () => {
    await Promise.all([
      utils.categories.list.invalidate(),
      utils.categories.tree.invalidate(),
      utils.categories.getById.invalidate(),
    ]);
  };

  const createMutation = api.categories.create.useMutation({
    onSuccess: async () => {
      await invalidateCategoryData();
      closeModal();
    },
  });

  const updateMutation = api.categories.update.useMutation({
    onSuccess: async () => {
      await invalidateCategoryData();
      closeModal();
    },
  });

  const deleteMutation = api.categories.delete.useMutation({
    onSuccess: async () => {
      await invalidateCategoryData();
      setDeleteConfirm(null);
    },
  });

  const selectableParents = useMemo(() => {
    if (!categories) return [];
    if (!editingCategory) return categories;
    return categories.filter((c) => c.id !== editingCategory.id);
  }, [categories, editingCategory]);

  const openAddModal = (parent?: CategoryNode) => {
    setEditingCategory(null);
    setFormData({
      ...EMPTY_FORM,
      parentId: parent?.id ?? '',
      defaultClassification: parent?.defaultClassification ?? '',
      color: parent?.color ?? '#3b82f6',
    });
    setShowAddModal(true);
  };

  const openEditModal = (category: CategoryNode) => {
    setShowAddModal(false);
    setFormData({
      name: category.name,
      color: category.color || '#3b82f6',
      icon: category.icon || '',
      defaultClassification: category.defaultClassification || '',
      parentId: category.parentId || '',
    });
    setEditingCategory({
      id: category.id,
      name: category.name,
      color: category.color || '#3b82f6',
      icon: category.icon || '',
      defaultClassification: category.defaultClassification || '',
      parentId: category.parentId || '',
    });
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingCategory(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: formData.name.trim(),
      color: formData.color,
      icon: formData.icon || undefined,
      defaultClassification: formData.defaultClassification || undefined,
      parentId: formData.parentId || null,
    };

    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data });
      return;
    }

    createMutation.mutate(data);
  };

  const renderCategoryRows = (nodes: CategoryNode[], depth = 0): React.ReactNode => {
    return nodes.map((category) => (
      <div key={category.id} className="space-y-2">
        <div
          className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/40 transition-colors"
          style={{ marginLeft: `${depth * 16}px` }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: category.color || '#3b82f6' }}
            />
            <span className="font-medium truncate">{category.name}</span>
            {category.icon && <span className="text-lg shrink-0">{category.icon}</span>}
            {category.defaultClassification && (
              <Badge className={classificationColors[category.defaultClassification] || 'bg-gray-100'}>
                {category.defaultClassification}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground shrink-0">
              ({category._count?.transactions ?? 0} transactions)
            </span>
            {(category.children?.length ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground shrink-0">
                {(category.children?.length ?? 0)} subcategories
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/categories/${category.id}`}>
                Organize
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openAddModal(category)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Subcategory
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => openEditModal(category)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDeleteConfirm(category.id)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>

        {(category.children?.length ?? 0) > 0 && renderCategoryRows(category.children ?? [], depth + 1)}
      </div>
    ));
  };

  const isLoading = listLoading || treeLoading;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Categories</h1>
            <p className="text-muted-foreground">
              Create top-level categories and subcategories, then organize transactions into them.
            </p>
          </div>
          <Button onClick={() => openAddModal()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Category Tree</CardTitle>
            <CardDescription>
              {(categories?.length ?? 0)} total categories
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : (categoryTree?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {renderCategoryRows((categoryTree ?? []) as CategoryNode[])}
              </div>
            ) : (
              <p className="text-center py-4 text-muted-foreground text-sm">
                No categories yet. Add your first category to get started.
              </p>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={showAddModal || !!editingCategory} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Add Category'}</DialogTitle>
            <DialogDescription>
              {editingCategory
                ? 'Update this category and its hierarchy settings.'
                : 'Create a new category or subcategory for organizing transactions.'}
            </DialogDescription>
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
                <label className="text-sm font-medium">Parent Category</label>
                <Select
                  value={formData.parentId}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                >
                  <option value="">Top-level category</option>
                  {selectableParents.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Icon (emoji)</label>
                <Input
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="e.g., cart, food, car emoji"
                  maxLength={10}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Default Classification</label>
                <Select
                  value={formData.defaultClassification}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      defaultClassification: e.target.value as ClassificationType | '',
                    })
                  }
                >
                  {classificationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Transactions assigned to this category can inherit this classification automatically.
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

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
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
