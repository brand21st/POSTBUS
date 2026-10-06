"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, MoreHorizontal, Plus, SlidersHorizontal, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { LineItemThumb } from "@/components/dashboard/line-item-thumb";
import { emptyPhotoSlots, padPhotoSlots, ProductImageSlots } from "@/components/dashboard/product-image-slots";
import { SideSheet } from "@/components/dashboard/side-sheet";
import { ProductEditorFields } from "@/app/dashboard/inventory/product-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { asPaginated } from "@/lib/dashboard/records";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { optimizeImageFile } from "@/lib/images/optimize-client";
import { createProductSchema, editProductFormSchema } from "@/modules/products/schema";
import type { InventoryMovementRecord, Paginated, ProductRecord } from "@/types/api";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
type CreateValues = z.infer<typeof createProductSchema>;
type EditValues = z.infer<typeof editProductFormSchema>;
type ProductRow = ProductRecord & Record<string, unknown>;

function stockBadge(product: ProductRecord) {
  const threshold = product.lowStockThreshold ?? 5;
  if (product.onHand <= 0) return <Badge variant="outline">Out of stock</Badge>;
  if (product.onHand <= threshold) return <Badge variant="warning">Low · {product.onHand}</Badge>;
  return <span className="tabular-nums">{product.onHand}</span>;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-11 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterNumber({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string | undefined) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        key={value}
        className="mt-1 h-11"
        type="number"
        min={0}
        defaultValue={value}
        onBlur={(event) => onCommit(event.target.value || undefined)}
      />
    </div>
  );
}

function FilterDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1 h-11" type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function InventoryProducts({
  canWrite,
  searchParams,
}: {
  canWrite: boolean;
  searchParams: URLSearchParams;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const page = Number(searchParams.get("page") || 1);
  const pageSize = Number(searchParams.get("pageSize") || 20);
  const q = searchParams.get("q") ?? "";
  const active = searchParams.get("active") || "all";
  const storeVisible = searchParams.get("storeVisible") || "all";
  const stock = searchParams.get("stock") || "all";
  const categoryId = searchParams.get("categoryId") || "all";
  const prepaid = searchParams.get("prepaid") || "all";
  const cod = searchParams.get("cod") || "all";
  const bestSeller = searchParams.get("bestSeller") || "all";
  const analyticsRange = searchParams.get("analyticsRange") || "all";
  const sort = searchParams.get("sort") || "newest";
  const priceMin = searchParams.get("priceMin") ?? "";
  const priceMax = searchParams.get("priceMax") ?? "";
  const stockMin = searchParams.get("stockMin") ?? "";
  const stockMax = searchParams.get("stockMax") ?? "";
  const createdFrom = searchParams.get("createdFrom") ?? "";
  const createdTo = searchParams.get("createdTo") ?? "";
  const updatedFrom = searchParams.get("updatedFrom") ?? "";
  const updatedTo = searchParams.get("updatedTo") ?? "";

  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductRecord | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<ProductRecord | null>(null);
  const [historyProduct, setHistoryProduct] = useState<ProductRecord | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("0");
  const [adjustNote, setAdjustNote] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [historyReason, setHistoryReason] = useState<string>("all");
  const [createFiles, setCreateFiles] = useState<Array<File | null>>([null, null, null]);
  const [createUrls, setCreateUrls] = useState<Array<string | null>>(emptyPhotoSlots());
  const [editUrls, setEditUrls] = useState<Array<string | null>>(emptyPhotoSlots());
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [searchDraft, setSearchDraft] = useState(q);
  const searchTimer = useRef<number | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ["product-categories"],
    queryFn: () => api<Array<{ id: string; name: string; active: boolean }>>("/api/v1/inventory/categories"),
  });
  const catalogQuery = useQuery({
    queryKey: ["products", "picker"],
    queryFn: () => api<Paginated<ProductRecord>>("/api/v1/products?page=1&pageSize=100&active=true"),
  });
  const listQuery = useQuery({
    queryKey: [
      "products",
      page,
      pageSize,
      q,
      active,
      storeVisible,
      stock,
      categoryId,
      prepaid,
      cod,
      bestSeller,
      analyticsRange,
      priceMin,
      priceMax,
      stockMin,
      stockMax,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      sort,
    ],
    queryFn: () =>
      api<Paginated<ProductRecord>>(
        `/api/v1/products?${toSearchParams({
          page,
          pageSize,
          q,
          active,
          storeVisible,
          stock,
          categoryId: categoryId === "all" ? undefined : categoryId,
          prepaid,
          cod,
          bestSeller,
          analyticsRange,
          priceMin: priceMin || undefined,
          priceMax: priceMax || undefined,
          stockMin: stockMin || undefined,
          stockMax: stockMax || undefined,
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
          updatedFrom: updatedFrom || undefined,
          updatedTo: updatedTo || undefined,
          sort,
        })}`
      ),
    placeholderData: keepPreviousData,
  });
  const pageData = asPaginated<ProductRecord>(listQuery.data);
  const rows = (pageData.items ?? []) as ProductRow[];

  const movements = useQuery({
    queryKey: ["inventory-movements", historyProduct?.id, historyReason],
    enabled: Boolean(historyProduct?.id),
    queryFn: () =>
      api<Paginated<InventoryMovementRecord>>(
        `/api/v1/inventory/movements?${toSearchParams({
          productId: historyProduct?.id,
          reason: historyReason === "all" ? undefined : historyReason,
          page: 1,
          pageSize: 50,
        })}`
      ),
  });

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createProductSchema) as never,
    defaultValues: {
      name: "",
      sku: "",
      price: 0,
      weightGrams: 0,
      openingStock: 0,
      prepaidEnabled: true,
      codEnabled: true,
      codAdvancePercent: 0,
      compareAtPrice: null,
      description: "",
      storeVisible: true,
      featured: false,
      lowStockThreshold: 5,
      categoryIds: [],
      upsellProductIds: [],
      crossSellProductIds: [],
    },
  });
  const editForm = useForm<EditValues>({
    resolver: zodResolver(editProductFormSchema) as never,
  });

  function setParams(patch: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "products");
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "" || value === "all") next.delete(key);
      else next.set(key, String(value));
    }
    router.replace(`/dashboard/inventory?${next.toString()}`);
  }

  function revokeIfBlob(url: string | null | undefined) {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  function resetCreatePhotos() {
    createUrls.forEach(revokeIfBlob);
    setCreateFiles([null, null, null]);
    setCreateUrls(emptyPhotoSlots());
  }

  function moveItem<T>(items: T[], from: number, to: number) {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  function reorderCreatePhotos(from: number, to: number) {
    setCreateFiles((current) => moveItem(current, from, to));
    setCreateUrls((current) => moveItem(current, from, to));
  }

  async function reorderSavedPhotos(from: number, to: number) {
    if (!editProduct) return;
    const reordered = moveItem(editUrls, from, to);
    setEditUrls(reordered);
    setPhotoBusy(to);
    try {
      const next = await api<ProductRecord>(`/api/v1/products/${editProduct.id}`, {
        method: "PATCH",
        body: JSON.stringify({ imageUrls: reordered.filter((url): url is string => Boolean(url)) }),
      });
      setEditProduct(next);
      setEditUrls(padPhotoSlots(next.imageUrls));
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      setEditUrls(padPhotoSlots(editProduct.imageUrls));
      toast.error(error instanceof Error ? error.message : "Could not reorder photos.");
    } finally {
      setPhotoBusy(null);
    }
  }

  async function uploadProductPhoto(id: string, file: File, slot?: number) {
    const optimized = await optimizeImageFile(file, { maxWidth: 1200, maxHeight: 1200 });
    const body = new FormData();
    body.append("image", optimized);
    if (slot != null) body.append("slot", String(slot));
    return api<ProductRecord>(`/api/v1/products/${id}/images`, { method: "POST", body });
  }

  const createMutation = useMutation({
    mutationFn: async (values: CreateValues) => {
      const created = await api<ProductRecord>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(values),
      });
      for (const [slot, file] of createFiles.entries()) {
        if (!file) continue;
        await uploadProductPhoto(created.id, file, slot);
      }
      return created;
    },
    onSuccess: () => {
      toast.success("Product added.");
      setCreateOpen(false);
      resetCreatePhotos();
      createForm.reset();
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-analytics"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditValues }) =>
      api<ProductRecord>(`/api/v1/products/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      toast.success("Product updated.");
      setEditProduct(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const adjustMutation = useMutation({
    mutationFn: (input: { id: string; quantityDelta: number; note?: string }) =>
      api(`/api/v1/products/${input.id}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ quantityDelta: input.quantityDelta, note: input.note, reason: "ADJUSTMENT" }),
      }),
    onSuccess: () => {
      toast.success("Stock updated.");
      setAdjustProduct(null);
      setAdjustDelta("0");
      setAdjustNote("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-analytics"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bulkMutation = useMutation({
    mutationFn: (patch: { active?: boolean; storeVisible?: boolean }) =>
      api("/api/v1/products/bulk", { method: "POST", body: JSON.stringify({ ids: selectedIds, ...patch }) }),
    onSuccess: () => {
      toast.success("Products updated.");
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openEdit(product: ProductRecord) {
    setEditProduct(product);
    setEditUrls(padPhotoSlots(product.imageUrls));
    editForm.reset({
      name: product.name,
      sku: product.sku,
      price: product.price,
      compareAtPrice: product.compareAtPrice ?? null,
      description: product.description ?? "",
      weightGrams: product.weightGrams,
      prepaidEnabled: product.prepaidEnabled,
      codEnabled: product.codEnabled,
      codAdvancePercent: product.codAdvancePercent,
      storeVisible: product.storeVisible !== false,
      featured: Boolean(product.featured),
      active: product.active,
      lowStockThreshold: product.lowStockThreshold ?? 5,
      categoryIds: product.categoryIds ?? [],
      upsellProductIds: product.upsellProductIds ?? [],
      crossSellProductIds: product.crossSellProductIds ?? [],
    });
  }

  const storeUrl = useQuery({
    queryKey: ["inventory-storefront"],
    queryFn: () => api<{ storeUrl: string }>("/api/v1/inventory/storefront"),
  });

  const columns = useMemo<DataTableColumn<ProductRow>[]>(
    () => [
      {
        id: "product",
        header: "Product",
        fill: true,
        cell: (row) => (
          <div className="flex items-center gap-3">
            <LineItemThumb title={row.name} imageUrl={row.imageUrls?.[0]} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-medium">{row.name}</p>
                {row.bestSeller ? (
                  <Badge variant="warning">
                    <Flame className="mr-1 size-3" /> Best seller
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted">{row.sku}</p>
            </div>
          </div>
        ),
      },
      {
        id: "pricing",
        header: "Pricing",
        hug: true,
        cell: (row) => {
          const discount =
            row.compareAtPrice && row.compareAtPrice > row.price
              ? Math.round(((row.compareAtPrice - row.price) / row.compareAtPrice) * 100)
              : 0;
          return (
            <div>
              <p className="font-medium tabular-nums">{formatCurrency(row.price)}</p>
              {row.compareAtPrice ? (
                <p className="text-xs text-muted">
                  <span className="line-through">{formatCurrency(row.compareAtPrice)}</span>
                  {discount ? ` · ${discount}% off` : ""}
                </p>
              ) : null}
            </div>
          );
        },
      },
      { id: "stock", header: "Stock", hug: true, cell: (row) => stockBadge(row) },
      {
        id: "performance",
        header: "Performance",
        hug: true,
        cell: (row) => (
          <div className="text-xs">
            <p><span className="font-semibold tabular-nums">{formatNumber(row.orderCount ?? 0)}</span> orders</p>
            <p className="text-muted"><span className="tabular-nums">{formatNumber(row.unitsSold ?? 0)}</span> units</p>
          </div>
        ),
      },
      {
        id: "payment",
        header: "Payment",
        hug: true,
        cell: (row) => (
          <div className="text-xs">
            <p>{row.prepaidEnabled ? "Prepaid" : "No prepaid"}</p>
            <p className="text-muted">{row.codEnabled ? `COD · ${row.codAdvancePercent}% advance` : "No COD"}</p>
          </div>
        ),
      },
      {
        id: "store",
        header: "Store",
        hug: true,
        cell: (row) => (row.storeVisible === false ? <Badge variant="outline">Hidden</Badge> : <Badge variant="brand">Published</Badge>),
      },
      {
        id: "status",
        header: "Status",
        hug: true,
        cell: (row) => (row.active ? <Badge variant="brand">Active</Badge> : <Badge variant="outline">Inactive</Badge>),
      },
      {
        id: "actions",
        header: "",
        hug: true,
        cell: (row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${row.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEdit(row)}>Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAdjustProduct(row)}>Adjust stock</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHistoryProduct(row)}>Stock history</DropdownMenuItem>
              {storeUrl.data?.storeUrl ? (
                <DropdownMenuItem asChild>
                  <a href={storeUrl.data.storeUrl} target="_blank" rel="noreferrer">
                    View store
                  </a>
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await api(`/api/v1/products/${row.id}/duplicate`, { method: "POST" });
                      toast.success("Product duplicated.");
                      queryClient.invalidateQueries({ queryKey: ["products"] });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not duplicate.");
                    }
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem
                  onClick={() =>
                    updateMutation.mutate({
                      id: row.id,
                      values: { storeVisible: row.storeVisible === false } as EditValues,
                    })
                  }
                >
                  {row.storeVisible === false ? "Publish" : "Hide"}
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem
                  onClick={() =>
                    updateMutation.mutate({
                      id: row.id,
                      values: { active: !row.active } as EditValues,
                    })
                  }
                >
                  {row.active ? "Deactivate" : "Activate"}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, queryClient, storeUrl.data?.storeUrl]
  );

  const after = Number(adjustProduct?.onHand ?? 0) + Number(adjustDelta || 0);
  const filterKeys = [
    "active",
    "storeVisible",
    "stock",
    "categoryId",
    "prepaid",
    "cod",
    "bestSeller",
    "priceMin",
    "priceMax",
    "stockMin",
    "stockMax",
    "createdFrom",
    "createdTo",
    "updatedFrom",
    "updatedTo",
  ] as const;
  const activeFilters = filterKeys
    .map((key) => ({ key, value: searchParams.get(key) }))
    .filter((item): item is { key: (typeof filterKeys)[number]; value: string } => Boolean(item.value));

  function clearFilters() {
    setParams(Object.fromEntries(filterKeys.map((key) => [key, undefined])));
  }

  function dateValue(key: string) {
    const value = searchParams.get(key);
    return value ? value.slice(0, 10) : "";
  }

  function setDate(key: string, value: string, endOfDay = false) {
    setParams({
      [key]: value
        ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`).toISOString()
        : undefined,
      page: 1,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Input
            className="h-11 pr-24"
            placeholder="Search products or SKU"
            value={searchDraft}
            onChange={(event) => {
              const value = event.target.value;
              setSearchDraft(value);
              if (searchTimer.current) window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => setParams({ q: value, page: 1 }), 300);
            }}
          />
          {listQuery.isFetching ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">Searching…</span>
          ) : null}
        </div>
        <Button type="button" className="h-11" variant="secondary" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="size-4" />
          Filters
          {activeFilters.length ? <Badge variant="brand">{activeFilters.length}</Badge> : null}
        </Button>
        <Select value={sort} onValueChange={(value) => setParams({ sort: value, page: 1 })}>
          <SelectTrigger className="h-11 w-full sm:w-[190px]"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="nameAsc">Name A → Z</SelectItem>
            <SelectItem value="nameDesc">Name Z → A</SelectItem>
            <SelectItem value="priceAsc">Price low → high</SelectItem>
            <SelectItem value="priceDesc">Price high → low</SelectItem>
            <SelectItem value="stockAsc">Stock low → high</SelectItem>
            <SelectItem value="stockDesc">Stock high → low</SelectItem>
            <SelectItem value="orders">Most orders</SelectItem>
            <SelectItem value="units">Most units sold</SelectItem>
            <SelectItem value="bestSeller">Best sellers</SelectItem>
          </SelectContent>
        </Select>
        <Select value={analyticsRange} onValueChange={(value) => setParams({ analyticsRange: value, page: 1 })}>
          <SelectTrigger className="h-11 w-full sm:w-[150px]"><SelectValue placeholder="Sales period" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All-time sales</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        {canWrite ? (
          <Button className="ml-auto h-11" type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Add product
          </Button>
        ) : null}
      </div>

      {activeFilters.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map(({ key, value }) => (
            <button
              key={key}
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium"
              onClick={() => setParams({ [key]: undefined, page: 1 })}
            >
              {key}: {value === "true" ? "Enabled" : value === "false" ? "Disabled" : value}
              <X className="size-3" />
            </button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>Clear all</Button>
        </div>
      ) : null}

      {selectedIds.length && canWrite ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2">
          <p className="text-sm font-medium">{selectedIds.length} selected</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!window.confirm(`Publish ${selectedIds.length} products to the store?`)) return;
              bulkMutation.mutate({ storeVisible: true });
            }}
          >
            Publish
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!window.confirm(`Hide ${selectedIds.length} products from the store?`)) return;
              bulkMutation.mutate({ storeVisible: false });
            }}
          >
            Hide
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!window.confirm(`Activate ${selectedIds.length} products?`)) return;
              bulkMutation.mutate({ active: true });
            }}
          >
            Activate
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!window.confirm(`Deactivate ${selectedIds.length} products?`)) return;
              bulkMutation.mutate({ active: false });
            }}
          >
            Deactivate
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={rows}
        loading={listQuery.isLoading}
        fetching={listQuery.isFetching}
        error={listQuery.error as Error | null}
        emptyTitle="Add your first product"
        emptyDescription="Add a product to manage SKU, price, weight, and stock."
        emptyAction={
          canWrite ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Add product
            </Button>
          ) : undefined
        }
        page={pageData.page || page}
        pageSize={pageData.pageSize || pageSize}
        total={pageData.total}
        onPageChange={(next) => setParams({ page: next })}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => setParams({ pageSize: size, page: 1 })}
        selectable={canWrite}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        getRowId={(row) => row.id}
        stackBelow="lg"
        mobileView={
          <div className="grid gap-3">
            {rows.map((row) => (
              <article key={row.id} className="rounded-2xl border border-border bg-card p-3 shadow-sm">
                <div className="flex gap-3">
                  <LineItemThumb title={row.name} imageUrl={row.imageUrls?.[0]} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold">{row.name}</p>
                      {row.bestSeller ? <Badge variant="warning">Best seller</Badge> : null}
                    </div>
                    <p className="text-xs text-muted">{row.sku}</p>
                    <p className="mt-1 text-sm font-medium">{formatCurrency(row.price)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {stockBadge(row)}
                      <span className="text-xs text-muted">
                        {formatNumber(row.orderCount ?? 0)} orders · {formatNumber(row.unitsSold ?? 0)} units
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Button>
                  <Button size="sm" variant="secondary" onClick={() => setAdjustProduct(row)}>Adjust</Button>
                </div>
              </article>
            ))}
          </div>
        }
      />

      <SideSheet
        open={filtersOpen}
        title="Advanced filters"
        description="Filters and sorting run on the server, so large catalogs stay fast."
        onClose={() => setFiltersOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={clearFilters}>Clear all</Button>
            <Button type="button" onClick={() => setFiltersOpen(false)}>Show products</Button>
          </div>
        }
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Catalog state</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <FilterSelect
                label="Product status"
                value={active}
                onChange={(value) => setParams({ active: value, page: 1 })}
                options={[
                  ["all", "All statuses"],
                  ["true", "Active"],
                  ["false", "Inactive"],
                ]}
              />
              <FilterSelect
                label="Store visibility"
                value={storeVisible}
                onChange={(value) => setParams({ storeVisible: value, page: 1 })}
                options={[
                  ["all", "All visibility"],
                  ["true", "Published"],
                  ["false", "Hidden"],
                ]}
              />
              <FilterSelect
                label="Stock state"
                value={stock}
                onChange={(value) => setParams({ stock: value, page: 1 })}
                options={[
                  ["all", "All stock"],
                  ["inStock", "Healthy"],
                  ["lowStock", "Low stock"],
                  ["outOfStock", "Out of stock"],
                ]}
              />
              <FilterSelect
                label="Category"
                value={categoryId}
                onChange={(value) => setParams({ categoryId: value, page: 1 })}
                options={[
                  ["all", "All categories"],
                  ...(categoriesQuery.data ?? []).map((category) => [category.id, category.name] as [string, string]),
                ]}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Payments and performance</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <FilterSelect
                label="Prepaid"
                value={prepaid}
                onChange={(value) => setParams({ prepaid: value, page: 1 })}
                options={[["all", "Any"], ["true", "Enabled"], ["false", "Disabled"]]}
              />
              <FilterSelect
                label="COD"
                value={cod}
                onChange={(value) => setParams({ cod: value, page: 1 })}
                options={[["all", "Any"], ["true", "Enabled"], ["false", "Disabled"]]}
              />
              <FilterSelect
                label="Best seller"
                value={bestSeller}
                onChange={(value) => setParams({ bestSeller: value, page: 1 })}
                options={[["all", "Any"], ["true", "Best sellers"], ["false", "Other products"]]}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Price and stock range</h3>
            <div className="grid grid-cols-2 gap-3">
              <FilterNumber label="Minimum price" value={priceMin} onCommit={(value) => setParams({ priceMin: value, page: 1 })} />
              <FilterNumber label="Maximum price" value={priceMax} onCommit={(value) => setParams({ priceMax: value, page: 1 })} />
              <FilterNumber label="Minimum stock" value={stockMin} onCommit={(value) => setParams({ stockMin: value, page: 1 })} />
              <FilterNumber label="Maximum stock" value={stockMax} onCommit={(value) => setParams({ stockMax: value, page: 1 })} />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Dates</h3>
            <div className="grid grid-cols-2 gap-3">
              <FilterDate label="Created from" value={dateValue("createdFrom")} onChange={(value) => setDate("createdFrom", value)} />
              <FilterDate label="Created to" value={dateValue("createdTo")} onChange={(value) => setDate("createdTo", value, true)} />
              <FilterDate label="Updated from" value={dateValue("updatedFrom")} onChange={(value) => setDate("updatedFrom", value)} />
              <FilterDate label="Updated to" value={dateValue("updatedTo")} onChange={(value) => setDate("updatedTo", value, true)} />
            </div>
          </section>
        </div>
      </SideSheet>

      <SideSheet
        open={createOpen}
        title="Add product"
        description="Catalog price and weight are copied onto new order lines."
        onClose={() => {
          setCreateOpen(false);
          resetCreatePhotos();
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" disabled={createMutation.isPending} onClick={createForm.handleSubmit((values) => createMutation.mutate(values))}>
              {createMutation.isPending ? "Saving…" : "Save product"}
            </Button>
          </div>
        }
      >
        <form className="space-y-4" onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          <ProductImageSlots
            urls={createUrls}
            disabled={!canWrite || createMutation.isPending}
            onSetCover={(slot) => reorderCreatePhotos(slot, 0)}
            onReorder={reorderCreatePhotos}
            onPick={(slot, file) => {
              setCreateFiles((current) => {
                const next = [...current];
                next[slot] = file;
                return next;
              });
              setCreateUrls((current) => {
                const next = [...current];
                if (next[slot]?.startsWith("blob:")) URL.revokeObjectURL(next[slot]!);
                next[slot] = URL.createObjectURL(file);
                return next;
              });
            }}
            onRemove={(slot) => {
              setCreateFiles((current) => {
                const next = [...current];
                next[slot] = null;
                return next;
              });
              setCreateUrls((current) => {
                const next = [...current];
                if (next[slot]?.startsWith("blob:")) URL.revokeObjectURL(next[slot]!);
                next[slot] = null;
                return next;
              });
            }}
          />
          <ProductEditorFields
            form={createForm}
            showOpening
            categories={categoriesQuery.data ?? []}
            catalog={(catalogQuery.data?.items ?? []).map((item) => ({ id: item.id, name: item.name, sku: item.sku }))}
          />
        </form>
      </SideSheet>

      <SideSheet
        open={Boolean(editProduct)}
        title="Edit product"
        description="Changing price or weight does not update existing orders."
        onClose={() => {
          setEditProduct(null);
          setEditUrls(emptyPhotoSlots());
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditProduct(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={updateMutation.isPending || photoBusy != null}
              onClick={editForm.handleSubmit((values) => {
                if (!editProduct) return;
                updateMutation.mutate({ id: editProduct.id, values });
              })}
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        }
      >
        {editProduct ? (
          <form className="space-y-4">
            <ProductImageSlots
              urls={editUrls}
              disabled={!canWrite || updateMutation.isPending}
              busySlot={photoBusy}
              onSetCover={(slot) => void reorderSavedPhotos(slot, 0)}
              onReorder={(from, to) => void reorderSavedPhotos(from, to)}
              onPick={async (slot, file) => {
                setPhotoBusy(slot);
                try {
                  const filled = Boolean(editUrls[slot]);
                  const next = await uploadProductPhoto(editProduct.id, file, filled ? slot : undefined);
                  setEditProduct(next);
                  setEditUrls(padPhotoSlots(next.imageUrls));
                  queryClient.invalidateQueries({ queryKey: ["products"] });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not upload that photo.");
                } finally {
                  setPhotoBusy(null);
                }
              }}
              onRemove={async (slot) => {
                if (!editUrls[slot]) return;
                setPhotoBusy(slot);
                try {
                  const next = await api<ProductRecord>(`/api/v1/products/${editProduct.id}/images?slot=${slot}`, {
                    method: "DELETE",
                  });
                  setEditProduct(next);
                  setEditUrls(padPhotoSlots(next.imageUrls));
                  queryClient.invalidateQueries({ queryKey: ["products"] });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not remove that photo.");
                } finally {
                  setPhotoBusy(null);
                }
              }}
            />
            <ProductEditorFields
              form={editForm}
              showOpening={false}
              categories={categoriesQuery.data ?? []}
              catalog={(catalogQuery.data?.items ?? [])
                .filter((item) => item.id !== editProduct.id)
                .map((item) => ({ id: item.id, name: item.name, sku: item.sku }))}
            />
          </form>
        ) : null}
      </SideSheet>

      <Dialog open={Boolean(adjustProduct)} onOpenChange={(open) => !open && setAdjustProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              {adjustProduct?.name} · current stock {adjustProduct?.onHand ?? 0}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="adjust-delta">Adjustment</Label>
              <Input id="adjust-delta" className="mt-1 h-11" type="number" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="adjust-note">Reason</Label>
              <Textarea id="adjust-note" className="mt-1 min-h-[80px]" placeholder="Purchase, correction, damaged, restock…" value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} />
            </div>
            <p className="rounded-xl bg-surface-soft px-3 py-2 text-sm">
              Preview: {adjustProduct?.onHand ?? 0} → {Number.isFinite(after) ? after : "—"}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAdjustProduct(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={adjustMutation.isPending || Number(adjustDelta) === 0 || after < 0}
              onClick={() => {
                if (!adjustProduct) return;
                adjustMutation.mutate({ id: adjustProduct.id, quantityDelta: Number(adjustDelta), note: adjustNote });
              }}
            >
              {adjustMutation.isPending ? "Saving…" : "Confirm adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyProduct)} onOpenChange={(open) => !open && setHistoryProduct(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Stock history</DialogTitle>
            <DialogDescription>
              {historyProduct?.name} · SKU {historyProduct?.sku}
            </DialogDescription>
          </DialogHeader>
          <Select value={historyReason} onValueChange={setHistoryReason}>
            <SelectTrigger className="h-11 w-full sm:w-[220px]"><SelectValue placeholder="Reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              <SelectItem value="OPENING">Opening</SelectItem>
              <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
              <SelectItem value="ORDER_COMMIT">Order commit</SelectItem>
              <SelectItem value="ORDER_RELEASE">Order release</SelectItem>
              <SelectItem value="RTO_RETURN">RTO return</SelectItem>
            </SelectContent>
          </Select>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-2">Date</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>After</th>
                  <th>Note / order</th>
                </tr>
              </thead>
              <tbody>
                {(movements.data?.items ?? []).map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="py-2">{formatDate(row.createdAt, true)}</td>
                    <td>{row.reason}</td>
                    <td className="tabular-nums">{row.quantityDelta > 0 ? "+" : ""}{row.quantityDelta}</td>
                    <td className="tabular-nums">{row.balanceAfter}</td>
                    <td>
                      {row.orderId ? (
                        <a className="text-brand" href={`/dashboard/orders/${row.orderId}`}>Order</a>
                      ) : (
                        row.note || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {movements.isLoading ? <p className="py-6 text-sm text-muted">Loading movements…</p> : null}
            {!movements.isLoading && !(movements.data?.items ?? []).length ? (
              <p className="py-6 text-sm text-muted">No stock movements yet.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
