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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Building2, User } from 'lucide-react';

type EntityType = 'PERSON' | 'BUSINESS' | 'PROJECT';

interface EntityFormData {
  name: string;
  type: EntityType;
}

export default function EntitiesPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEntity, setEditingEntity] = useState<{ id: string; name: string; type: EntityType } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formData, setFormData] = useState<EntityFormData>({ name: '', type: 'PERSON' });

  const utils = api.useUtils();
  const { data: entities, isLoading } = api.entities.list.useQuery();

  const createMutation = api.entities.create.useMutation({
    onSuccess: () => {
      utils.entities.list.invalidate();
      setShowAddModal(false);
      setFormData({ name: '', type: 'PERSON' });
    },
  });

  const updateMutation = api.entities.update.useMutation({
    onSuccess: () => {
      utils.entities.list.invalidate();
      setEditingEntity(null);
      setFormData({ name: '', type: 'PERSON' });
    },
  });

  const deleteMutation = api.entities.delete.useMutation({
    onSuccess: () => {
      utils.entities.list.invalidate();
      setDeleteConfirm(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingEntity) {
      updateMutation.mutate({ id: editingEntity.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const openEditModal = (entity: { id: string; name: string; type: EntityType }) => {
    setFormData({ name: entity.name, type: entity.type });
    setEditingEntity(entity);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingEntity(null);
    setFormData({ name: '', type: 'PERSON' });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Entities</CardTitle>
              <CardDescription>
                Manage personal and business entities for transaction tracking
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Entity
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {entities?.map((entity) => (
                  <div
                    key={entity.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${entity.type === 'BUSINESS' ? 'bg-blue-100' : 'bg-green-100'}`}>
                        {entity.type === 'BUSINESS' ? (
                          <Building2 className={`h-5 w-5 ${entity.type === 'BUSINESS' ? 'text-blue-600' : 'text-green-600'}`} />
                        ) : (
                          <User className="h-5 w-5 text-green-600" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium">{entity.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {entity.type === 'BUSINESS' ? 'Business Entity' : 'Personal Entity'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditModal(entity as { id: string; name: string; type: EntityType })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteConfirm(entity.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {entities?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No entities found. Create your first entity to get started.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Add/Edit Modal */}
      <Dialog open={showAddModal || !!editingEntity} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEntity ? 'Edit Entity' : 'Add Entity'}</DialogTitle>
            <DialogDescription>
              {editingEntity ? 'Update this entity.' : 'Add a person, business, or project to track transactions.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Entity name"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="type"
                      value="PERSON"
                      checked={formData.type === 'PERSON'}
                      onChange={() => setFormData({ ...formData, type: 'PERSON' })}
                      className="w-4 h-4"
                    />
                    <User className="h-4 w-4 text-green-600" />
                    Person
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="type"
                      value="BUSINESS"
                      checked={formData.type === 'BUSINESS'}
                      onChange={() => setFormData({ ...formData, type: 'BUSINESS' })}
                      className="w-4 h-4"
                    />
                    <Building2 className="h-4 w-4 text-blue-600" />
                    Business
                  </label>
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
                {editingEntity ? 'Save Changes' : 'Add Entity'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Entity</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <p className="py-4">
            Are you sure you want to delete this entity?
            All associated accounts and transactions will remain but will need to be reassigned.
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
