"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, ImagePlus, Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { StoreImage } from "@/components/storefront/store-image";
import { SideSheet } from "@/components/dashboard/side-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { optimizeImageFile } from "@/lib/images/optimize-client";
import type { Paginated, ProductRecord } from "@/types/api";

type Category = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sortOrder: number;
  active: boolean;
  productCount: number;
  productIds?: string[];
  imageUrl?: string | null;
};

type Draft = {
  id?: string;
  name: string;
  description: string;
  active: boolean;
  productIds: string[];
};

const EMPTY_DRAFT: Draft = { name: "", description: "", active: true, productIds: [] };

export function InventoryCategoriesManager({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const dragIndex = useRef<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImageOnSave, setRemoveImageOnSave] = useState(false);
  const [imageBusy, setImageBusy] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => api<Category[]>("/api/v1/inventory/categories"),
  });
  const products = useQuery({
    queryKey: ["products", "category-picker"],
    queryFn: () => api<Paginated<ProductRecord>>("/api/v1/products?page=1&pageSize=100&sort=nameAsc"),
  });

  async function uploadImage(id: string, file: File) {
    const optimized = await optimizeImageFile(file, { maxWidth: 1600, maxHeight: 900 });
    const body = new FormData();
    body.append("image", optimized);
    return api<Category>(`/api/v1/inventory/categories/${id}/image`, { method: "POST", body });
  }

  const save = useMutation({
    mutationFn: async (value: Draft) => {
      const category = value.id
        ? await api<Category>(`/api/v1/inventory/categories/${value.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: value.name,
              description: value.description,
              active: value.active,
              productIds: value.productIds,
            }),
          })
        : await api<Category>("/api/v1/inventory/categories", {
            method: "POST",
            body: JSON.stringify({
              name: value.name,
              description: value.description,
              active: value.active,
              productIds: value.productIds,
            }),
          });
      if (imageFile) return uploadImage(category.id, imageFile);
      if (removeImageOnSave && value.id) {
        return api<Category>(`/api/v1/inventory/categories/${category.id}/image`, { method: "DELETE" });
      }
      return category;
    },
    onSuccess: () => {
      toast.success(draft?.id ? "Category updated." : "Category created.");
      closeEditor();
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    },
    onError: (error: Error) => toast.error(error.message || "Something went wrong while saving the category."),
  });

  const ordered = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [list.data]
  );

  function openEditor(category?: Category) {
    setDraft(
      category
        ? {
            id: category.id,
            name: category.name,
            description: category.description ?? "",
            active: category.active,
            productIds: category.productIds ?? [],
          }
        : { ...EMPTY_DRAFT, productIds: [] }
    );
    setImageFile(null);
    setImagePreview(category?.imageUrl ?? null);
    setRemoveImageOnSave(false);
  }

  function closeEditor() {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setDraft(null);
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageOnSave(false);
  }

  async function persistOrder(ids: string[]) {
    try {
      await api("/api/v1/inventory/categories/reorder", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      await queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reorder categories.");
    }
  }

  async function removeImage(category: Category) {
    setImageBusy(category.id);
    try {
      await api(`/api/v1/inventory/categories/${category.id}/image`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      toast.success("Category image removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the image.");
    } finally {
      setImageBusy(null);
    }
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="font-semibold">Something went wrong while loading categories.</p>
        <Button className="mt-4" type="button" onClick={() => void list.refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-ink">Store categories</h2>
          <p className="text-sm text-muted">Drag categories to control their storefront order.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ordered.length > 1 && canWrite ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => void persistOrder([...ordered].sort((a, b) => a.name.localeCompare(b.name)).map((item) => item.id))}>
                A → Z
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void persistOrder([...ordered].sort((a, b) => b.name.localeCompare(a.name)).map((item) => item.id))}>
                Z → A
              </Button>
            </>
          ) : null}
          {canWrite ? (
            <Button type="button" size="sm" onClick={() => openEditor()}>
              <Plus className="size-4" /> Add category
            </Button>
          ) : null}
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}
        </div>
      ) : !ordered.length ? (
        <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <ImagePlus className="mx-auto size-9 text-muted" />
          <p className="mt-3 font-semibold">Create categories to organize your store.</p>
          {canWrite ? <Button className="mt-4" onClick={() => openEditor()}>Create category</Button> : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((category, index) => (
            <article
              key={category.id}
              draggable={canWrite}
              onDragStart={() => { dragIndex.current = index; }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                const from = dragIndex.current;
                dragIndex.current = null;
                if (from == null || from === index) return;
                const ids = ordered.map((item) => item.id);
                const [moved] = ids.splice(from, 1);
                ids.splice(index, 0, moved);
                void persistOrder(ids);
              }}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative aspect-[16/7] bg-surface-soft">
                <StoreImage src={category.imageUrl} alt={category.name} sizes="(max-width: 768px) 100vw, 33vw" />
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
                  {category.active ? "Visible" : "Hidden"}
                </span>
              </div>
              <div className="flex items-start gap-3 p-4">
                {canWrite ? (
                  <button type="button" className="mt-0.5 cursor-grab text-muted active:cursor-grabbing" aria-label={`Drag ${category.name}`}>
                    <GripVertical className="size-5" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{category.name}</p>
                  <p className="mt-0.5 text-sm text-muted">{category.productCount} {category.productCount === 1 ? "product" : "products"}</p>
                  {category.description ? <p className="mt-2 line-clamp-2 text-xs text-muted">{category.description}</p> : null}
                </div>
                {canWrite ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${category.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditor(category)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        await api(`/api/v1/inventory/categories/${category.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ active: !category.active }),
                        });
                        await queryClient.invalidateQueries({ queryKey: ["product-categories"] });
                      }}>
                        {category.active ? "Hide" : "Show"}
                      </DropdownMenuItem>
                      {category.imageUrl ? <DropdownMenuItem onClick={() => void removeImage(category)}>Remove image</DropdownMenuItem> : null}
                      <DropdownMenuItem onClick={async () => {
                        if (!window.confirm(`Delete ${category.name}? Products will remain in the catalog.`)) return;
                        await api(`/api/v1/inventory/categories/${category.id}`, { method: "DELETE" });
                        toast.success("Category deleted.");
                        await queryClient.invalidateQueries({ queryKey: ["product-categories"] });
                      }}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              {imageBusy === category.id ? <div className="px-4 pb-3 text-xs text-muted"><Loader2 className="mr-1 inline size-3 animate-spin" /> Updating image…</div> : null}
            </article>
          ))}
        </div>
      )}

      <SideSheet
        open={Boolean(draft)}
        title={draft?.id ? "Edit category" : "Add category"}
        description="Category media and ordering are shared with the public storefront."
        onClose={closeEditor}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeEditor}>Cancel</Button>
            <Button
              type="button"
              disabled={!draft?.name.trim() || save.isPending}
              onClick={() => draft && save.mutate(draft)}
            >
              {save.isPending ? "Saving…" : "Save category"}
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className="space-y-6">
            <section>
              <Label>Cover image</Label>
              <p className="mb-2 text-xs text-muted">Recommended 1600 × 900 px · JPG, PNG or WebP · up to 5 MB</p>
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                  setImageFile(file);
                  setImagePreview(URL.createObjectURL(file));
                  setRemoveImageOnSave(false);
                }}
              />
              <div
                className="relative aspect-video overflow-hidden rounded-2xl border border-dashed border-border bg-surface-soft"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files?.[0];
                  if (!file) return;
                  if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                  setImageFile(file);
                  setImagePreview(URL.createObjectURL(file));
                  setRemoveImageOnSave(false);
                }}
              >
                {imagePreview ? (
                  <>
                    <StoreImage src={imagePreview} alt="" sizes="560px" />
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/70 p-3 pt-8">
                      <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Replace</Button>
                      <Button type="button" size="icon" variant="secondary" aria-label="Remove selected image" onClick={() => {
                        if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                        setImageFile(null);
                        setImagePreview(null);
                        setRemoveImageOnSave(Boolean(draft.id));
                      }}><X className="size-4" /></Button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted" onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="size-7" />
                    <span>Drop an image or click to upload</span>
                  </button>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <Label htmlFor="category-name">Category name</Label>
                <Input id="category-name" className="mt-1 h-11" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="category-description">Description</Label>
                <Textarea id="category-description" className="mt-1 min-h-24" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </div>
              <div className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3">
                <Label htmlFor="category-visible">Visible on storefront</Label>
                <Switch id="category-visible" checked={draft.active} onCheckedChange={(active) => setDraft({ ...draft, active })} />
              </div>
            </section>

            <section>
              <Label>Assigned products</Label>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                {(products.data?.items ?? []).map((product) => {
                  const checked = draft.productIds.includes(product.id);
                  return (
                    <label key={product.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-soft">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const ids = new Set(draft.productIds);
                          if (event.target.checked) ids.add(product.id);
                          else ids.delete(product.id);
                          setDraft({ ...draft, productIds: [...ids] });
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{product.name}</span>
                      <span className="text-xs text-muted">{product.sku}</span>
                    </label>
                  );
                })}
                {!products.isLoading && !products.data?.items.length ? <p className="p-3 text-sm text-muted">Add products first, then assign them here.</p> : null}
              </div>
            </section>
          </div>
        ) : null}
      </SideSheet>
    </div>
  );
}
