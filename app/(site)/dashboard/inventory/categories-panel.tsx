"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";

type Category = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
  productCount?: number;
  imageUrl?: string | null;
};

export function InventoryCategories({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const list = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => api<Category[]>("/api/v1/inventory/categories"),
  });

  const create = useMutation({
    mutationFn: () => api<Category>("/api/v1/inventory/categories", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName("");
      toast.success("Category added.");
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function reorder(from: number, to: number) {
    const ids = (list.data ?? []).map((row) => row.id);
    if (to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    try {
      await api("/api/v1/inventory/categories/reorder", { method: "POST", body: JSON.stringify({ ids }) });
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder.");
    }
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-semibold">Something went wrong.</p>
        <Button className="mt-3" type="button" onClick={() => void list.refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input className="h-11" value={name} onChange={(event) => setName(event.target.value)} placeholder="Create your first category" />
          <Button className="h-11" type="submit" disabled={create.isPending}>Add category</Button>
        </form>
      ) : null}
      {!list.data?.length && !list.isLoading ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <p className="font-semibold text-ink">Create your first category</p>
          <p className="mt-1 text-sm text-muted">Categories appear in the same order on your storefront.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {(list.data ?? []).map((category, index) => (
            <li key={category.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {editing?.id === category.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      try {
                        await api(`/api/v1/inventory/categories/${category.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ name: editing.name }),
                        });
                        setEditing(null);
                        queryClient.invalidateQueries({ queryKey: ["product-categories"] });
                        toast.success("Category updated.");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not save.");
                      }
                    }}
                  >
                    <Input className="h-11" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                    <Button type="submit" size="sm">Save</Button>
                  </form>
                ) : (
                  <>
                    <p className="font-medium text-ink">{category.name}</p>
                    <p className="text-xs text-muted">
                      {category.productCount ?? 0} products · {category.active ? "Visible" : "Hidden"}
                    </p>
                  </>
                )}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" aria-label={`Move ${category.name} up`} onClick={() => void reorder(index, index - 1)}>
                    Up
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Move ${category.name} down`} onClick={() => void reorder(index, index + 1)}>
                    Down
                  </Button>
                  <Switch
                    checked={category.active}
                    onCheckedChange={async (checked) => {
                      try {
                        await api(`/api/v1/inventory/categories/${category.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ active: checked }),
                        });
                        queryClient.invalidateQueries({ queryKey: ["product-categories"] });
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not update.");
                      }
                    }}
                    aria-label={`Toggle ${category.name}`}
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(category)}>Edit</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${category.name}? Products stay in the catalog.`)) return;
                      try {
                        await api(`/api/v1/inventory/categories/${category.id}`, { method: "DELETE" });
                        toast.success("Category deleted.");
                        queryClient.invalidateQueries({ queryKey: ["product-categories"] });
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not delete.");
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
