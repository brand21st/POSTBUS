"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid, parseISO, subDays } from "date-fns";
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  MoreHorizontal,
  Plus,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { ShopifyLogo } from "@/components/brand/shopify-logo";
import { LineItemThumb } from "@/components/dashboard/line-item-thumb";
import { BulkIndiaPostBooking } from "@/components/bookings/bulk-india-post-booking";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import {
  OrderDateFilter,
  todayOrderRange,
  yesterdayOrderRange,
  type OrderDateFilterValue,
} from "@/components/dashboard/order-date-filter";
import { OrderKpiStrip } from "@/components/dashboard/order-kpi-strip";
import { PageHeader } from "@/components/dashboard/page-header";
import { ServiceToggle } from "@/components/dashboard/service-toggle";
import { orderStatusRowClass, StatusBadge } from "@/components/dashboard/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  asPaginated,
  customerName,
  customerPhone,
  firstLineItemImage,
  itemCount,
  itemNamesPreview,
  itemSummary,
  orderActionButtonClass,
  orderNumber,
  orderStageMenu,
} from "@/lib/dashboard/records";
import { formatCurrency, formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import {
  parcelServiceCode,
  resolveOrderBookingService,
  shipmentServiceLocked,
} from "@/modules/india-post/booking-service";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from "@/types/domain";
import type { BulkOrderStatusResult, DashboardKpis, IndiaPostConfig, IntegrationsResponse, OrderRecord, Paginated } from "@/types/api";

const PARCEL_OPTIONS = [
  { value: "SP_INLAND_PARCEL", label: "SP", title: "Speed Post parcel" },
  { value: "BUSINESS_PARCEL", label: "BP", title: "Business Parcel" },
];

const COLUMN_STORAGE = "postbus.orders.columns";
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_COLUMNS = {
  items: true,
  source: true,
  payment: true,
  created: true,
  service: true,
};

type OptionalColumn = keyof typeof DEFAULT_COLUMNS;

const COLUMN_LABELS: Record<OptionalColumn, string> = {
  items: "Items",
  source: "Source",
  payment: "Payment",
  created: "Created",
  service: "Service",
};

const FILTER_SELECT_CLASS = "h-9 shadow-none";

function CreatedCell({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const date = parseISO(value);
  if (!isValid(date)) return <span className="text-muted">—</span>;
  return (
    <div className="leading-tight">
      <p>{format(date, "d MMM yyyy")}</p>
      <p className="text-[11px] text-muted">{format(date, "h:mm a")}</p>
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<OrderDateFilterValue>({ kind: "all" });
  const [confirmFulfill, setConfirmFulfill] = useState(false);
  const [columnsReady, setColumnsReady] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_COLUMNS);

  const kpiWindow = useMemo(() => {
    const now = new Date();
    return {
      from: format(subDays(now, 29), "yyyy-MM-dd"),
      to: format(now, "yyyy-MM-dd"),
    };
  }, []);

  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    const timer = window.setTimeout(() => setSearch(q), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(COLUMN_STORAGE);
        if (raw) setVisibleColumns({ ...DEFAULT_COLUMNS, ...JSON.parse(raw) });
      } catch {
        /* ignore */
      }
      setColumnsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!columnsReady) return;
    window.localStorage.setItem(COLUMN_STORAGE, JSON.stringify(visibleColumns));
  }, [columnsReady, visibleColumns]);

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/v1/integrations"),
    staleTime: 60_000,
  });
  const indiaPost = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostConfig>("/api/v1/integrations/india-post"),
    staleTime: 60_000,
  });
  const kpis = useQuery({
    queryKey: ["dashboard-kpis", kpiWindow],
    queryFn: () => api<DashboardKpis>(`/api/v1/dashboard/kpis?${toSearchParams(kpiWindow)}`),
    staleTime: 60_000,
  });
  const shopify = integrations.data?.shopify;
  const shopifyStatus = (shopify?.status ?? "").toUpperCase();
  const shopifyReady = shopifyStatus === "CONNECTED" || Boolean(shopify?.readyToSync);
  const syncJobStatus = (shopify?.syncJobStatus ?? "").toUpperCase();
  const syncInFlight = ["QUEUED", "RUNNING", "RETRYING"].includes(syncJobStatus);
  const activeFrom = dateFilter.kind === "all" ? undefined : dateFilter.from.toISOString();
  const activeTo = dateFilter.kind === "all" ? undefined : dateFilter.to.toISOString();
  const todayRange = todayOrderRange();
  const yesterdayRange = yesterdayOrderRange();

  const query = useQuery({
    queryKey: [
      "orders",
      page,
      pageSize,
      debounced,
      status,
      source,
      payment,
      activeFrom,
      activeTo,
      todayRange.from.toISOString(),
    ],
    queryFn: () =>
      api<Paginated<OrderRecord>>(`/api/v1/orders?${toSearchParams({
        page,
        pageSize,
        q: debounced,
        status: status === "all" ? undefined : status,
        source: source === "all" ? undefined : source,
        paymentStatus: payment === "all" ? undefined : payment,
        from: activeFrom,
        to: activeTo,
        includeCounts: "1",
        todayFrom: todayRange.from.toISOString(),
        todayTo: todayRange.to.toISOString(),
        yesterdayFrom: yesterdayRange.from.toISOString(),
        yesterdayTo: yesterdayRange.to.toISOString(),
      })}`),
    placeholderData: keepPreviousData,
  });

  const list = asPaginated<OrderRecord>(query.data, ["orders", "items"]);
  const dateCounts = query.data?.counts ?? { all: list.total, today: undefined, yesterday: undefined };

  useEffect(() => {
    if (!syncInFlight) return;
    const tick = () => {
      if (document.hidden) return;
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    };
    const timer = window.setInterval(tick, 4000);
    return () => window.clearInterval(timer);
  }, [syncInFlight, queryClient]);

  const syncShopify = useMutation({
    mutationFn: () =>
      api<{ queued?: boolean; duplicate?: boolean; jobId?: string }>(
        "/api/v1/integrations/shopify/sync",
        { method: "POST" }
      ),
    onSuccess: (result) => {
      toast.success(result.duplicate ? "Shopify sync already running." : "Shopify sync queued.");
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const ship = useMutation({
    mutationFn: ({
      orderIds,
      action,
    }: {
      orderIds: string[];
      action: "processing" | "fulfill" | "in_transit" | "delivered";
    }) => api("/api/v1/shipments", { method: "POST", body: JSON.stringify({ orderIds, action }) }),
    onSuccess: (_result, variables) => {
      const one = variables.orderIds.length === 1;
      toast.success(
        variables.action === "processing"
          ? one
            ? "Order marked processing."
            : "Selected orders were marked processing."
          : variables.action === "in_transit"
            ? one
              ? "Order marked in transit."
              : "Selected orders were marked in transit."
            : variables.action === "delivered"
              ? one
                ? "Order marked delivered."
                : "Selected orders were marked delivered."
              : one
                ? "Order queued for booking and fulfillment."
                : "Selected orders were queued for booking and fulfillment."
      );
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setService = useMutation({
    mutationFn: ({ orderId, service }: { orderId: string; service: string }) =>
      api(`/api/v1/orders/${orderId}/service`, {
        method: "PATCH",
        body: JSON.stringify({ service }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bulkFulfill = useMutation({
    mutationFn: (orderIds: string[]) =>
      api<BulkOrderStatusResult>("/api/v1/orders/bulk/status", {
        method: "POST",
        body: JSON.stringify({ orderIds, action: "fulfill" }),
      }),
    onSuccess: (result) => {
      const updated = result.updated.length;
      const skipped = result.skipped.length;
      const failed = result.failed.length;
      const reasons = [...result.skipped, ...result.failed].map((item) => item.reason).slice(0, 4);
      if (updated && !skipped && !failed) {
        toast.success(
          updated === 1 ? "1 order marked as Booked / packed." : `${updated} orders marked as Booked / packed.`
        );
      } else if (updated) {
        toast.success(`${updated} orders updated · ${skipped + failed} skipped`, {
          description: reasons.join("\n"),
        });
      } else {
        toast.error(`${skipped + failed} orders skipped`, {
          description: reasons.join("\n") || "None of the selected orders can be marked Booked / packed.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      setSelected([]);
      setConfirmFulfill(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function exportCsv() {
    const params = toSearchParams({
      q: debounced,
      status: status === "all" ? undefined : status,
      source: source === "all" ? undefined : source,
      paymentStatus: payment === "all" ? undefined : payment,
      from: activeFrom,
      to: activeTo,
      format: "csv",
    });
    // File download from an authenticated API route.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${window.location.origin}/api/v1/orders/export?${params}`);
  }

  function resetFilters() {
    setSearch("");
    setDebounced("");
    setStatus("all");
    setSource("all");
    setPayment("all");
    setDateFilter({ kind: "all" });
    setPage(1);
  }

  function toggleColumn(key: OptionalColumn, next: boolean) {
    setVisibleColumns((current) => ({ ...current, [key]: next }));
  }

  function rowServiceToggle(row: OrderRecord) {
    const effective = resolveOrderBookingService({
      orderService: row.indiaPostService ?? row.india_post_service,
      workspaceOverride: indiaPost.data?.bookingServiceOverride,
      defaultService: indiaPost.data?.defaultServiceCode,
    });
    const locked = shipmentServiceLocked(row.shipment?.status);
    const pending = setService.isPending && setService.variables?.orderId === row.id;
    return (
      <ServiceToggle
        label={`India Post service for ${orderNumber(row)}`}
        value={parcelServiceCode(effective) ?? ""}
        options={PARCEL_OPTIONS}
        disabled={locked || pending}
        onChange={(service) => {
          if (service !== (row.indiaPostService ?? row.india_post_service)) {
            setService.mutate({ orderId: row.id, service });
          }
        }}
      />
    );
  }

  function rowActions(row: OrderRecord) {
    const pending = ship.isPending && (ship.variables?.orderIds ?? []).includes(row.id);
    const menu = orderStageMenu(row.status);
    const next = menu.next;
    return (
      <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        {visibleColumns.service ? rowServiceToggle(row) : null}
        {menu.hideActions || !next ? null : (
          <>
            <Button
              type="button"
              size="icon-xs"
              variant="secondary"
              className={cn("transition-all duration-150", orderActionButtonClass(row.status))}
              disabled={pending}
              aria-label={next.label}
              title={next.label}
              onClick={() => ship.mutate({ orderIds: [row.id], action: next.action })}
            >
              <Truck className="size-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Order actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                {menu.completed.map((step) => (
                  <DropdownMenuLabel
                    key={step.action}
                    className="flex items-center gap-2 py-2 text-sm font-normal text-muted-foreground"
                  >
                    <Check className="size-3.5 text-emerald-600" aria-hidden />
                    <span>{step.label}</span>
                  </DropdownMenuLabel>
                ))}
                <DropdownMenuItem
                  className="font-semibold"
                  disabled={pending}
                  onSelect={() => ship.mutate({ orderIds: [row.id], action: next.action })}
                >
                  {next.label}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    );
  }

  const columns: DataTableColumn<OrderRecord>[] = [
    {
      id: "order",
      header: "# Order",
      cell: (row) => (
        <Link href={`/dashboard/orders/${row.id}`} className="font-medium hover:text-brand">
          {orderNumber(row)}
        </Link>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => {
        const phone = customerPhone(row);
        return (
          <div className="min-w-0 leading-tight">
            <p className="truncate font-medium text-ink">{customerName(row)}</p>
            {phone ? <p className="truncate text-[11px] text-muted">{phone}</p> : null}
          </div>
        );
      },
    },
    ...(visibleColumns.items
      ? [
          {
            id: "items",
            header: "Items",
            cell: (row: OrderRecord) => {
              const summary = itemSummary(row);
              if (summary === "—") return "—";
              const count = itemCount(row);
              const preview = itemNamesPreview(row);
              return (
                <div className="flex max-w-[220px] items-center gap-2" title={summary}>
                  <LineItemThumb title={preview} imageUrl={firstLineItemImage(row)} />
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{count === 1 ? "1 item" : `${count} items`}</p>
                    <p className="truncate text-[11px] text-muted">{preview}</p>
                  </div>
                </div>
              );
            },
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    ...(visibleColumns.source
      ? [
          {
            id: "source",
            header: "Source",
            cell: (row: OrderRecord) => <StatusBadge value={row.source} />,
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusBadge value={row.status} />,
    },
    ...(visibleColumns.payment
      ? [
          {
            id: "payment",
            header: "Payment",
            cell: (row: OrderRecord) => <StatusBadge value={row.paymentStatus ?? row.payment_status} />,
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    {
      id: "total",
      header: "Total",
      cell: (row) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatCurrency(row.totalAmount ?? row.total_amount, row.currency)}
        </span>
      ),
    },
    ...(visibleColumns.created
      ? [
          {
            id: "created",
            header: "Created",
            cell: (row: OrderRecord) => <CreatedCell value={row.createdAt ?? row.created_at} />,
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    {
      id: "actions",
      header: "Actions",
      cell: (row) => rowActions(row),
    },
  ];

  const filterSelects = (
    <>
      <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
        <SelectTrigger className={FILTER_SELECT_CLASS}><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {ORDER_STATUSES.map((item) => (
            <SelectItem key={item} value={item}>{item}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={source} onValueChange={(value) => { setSource(value); setPage(1); }}>
        <SelectTrigger className={FILTER_SELECT_CLASS}><SelectValue placeholder="Source" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {ORDER_SOURCES.map((item) => (
            <SelectItem key={item} value={item}>{item}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={payment} onValueChange={(value) => { setPayment(value); setPage(1); }}>
        <SelectTrigger className={FILTER_SELECT_CLASS}><SelectValue placeholder="Payment" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All payments</SelectItem>
          {PAYMENT_STATUSES.map((item) => (
            <SelectItem key={item} value={item}>{PAYMENT_STATUS_LABELS[item]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  const description = shopifyReady
    ? syncInFlight
      ? syncJobStatus === "QUEUED"
        ? "Shopify sync is queued."
        : "Shopify sync is running."
      : shopify?.lastSyncAt
        ? `Last synced ${formatDate(shopify.lastSyncAt, true)}`
        : shopify?.lastError || shopify?.syncJobError
          ? `Shopify sync last failed: ${shopify.lastError || shopify.syncJobError}`
          : "Import Shopify orders for India Post shipping."
    : "Filter, export, and ship orders.";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description={description}
        icon={
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-brand">
            <ShoppingBag className="size-5" />
          </span>
        }
        actions={
          <>
            <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
              {shopifyReady ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  title={syncInFlight ? (syncJobStatus === "QUEUED" ? "Sync queued" : "Syncing…") : "Shopify Order Sync"}
                  aria-label={syncInFlight ? (syncJobStatus === "QUEUED" ? "Sync queued" : "Syncing") : "Shopify Order Sync"}
                  disabled={syncShopify.isPending || syncInFlight}
                  onClick={() => syncShopify.mutate()}
                >
                  <ShopifyLogo className={`h-3.5 ${syncShopify.isPending || syncInFlight ? "animate-pulse" : ""}`} />
                  Shopify Order Sync
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Export CSV"
                aria-label="Export CSV"
                onClick={exportCsv}
              >
                <Download className="size-4" />
              </Button>
            </div>
            {selected.length === 1 ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={ship.isPending}
                  onClick={() => ship.mutate({ orderIds: selected, action: "fulfill" })}
                >
                  <Truck className="size-4" />
                  Ship
                </Button>
                <BulkIndiaPostBooking
                  selectedIds={selected}
                  size="xs"
                  onQueued={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
                />
              </>
            ) : null}
            <Link href="/dashboard/orders/new" className={buttonVariants({ size: "xs" })}>
              <Plus className="size-4" />
              Add order
            </Link>
          </>
        }
      />

      <OrderKpiStrip
        data={kpis.data}
        loading={kpis.isLoading}
        error={kpis.isError}
        activeStatus={status}
        onSelect={(next) => {
          setStatus(next);
          setPage(1);
        }}
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <OrderDateFilter
          value={dateFilter}
          counts={{
            all: dateCounts.all,
            today: dateCounts.today,
            yesterday: dateCounts.yesterday,
          }}
          onChange={(next) => {
            setDateFilter(next);
            setPage(1);
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm" className="self-end">
              <Columns3 className="size-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            {(Object.keys(COLUMN_LABELS) as OptionalColumn[]).map((key) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={visibleColumns[key]}
                onCheckedChange={(checked) => toggleColumn(key, checked === true)}
              >
                {COLUMN_LABELS[key]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search order number, customer, phone…"
          className="h-9 shadow-none lg:max-w-sm lg:flex-1"
        />
        <div className="hidden min-w-0 flex-1 grid-cols-3 gap-2 lg:grid">
          {filterSelects}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary" size="sm">
                <SlidersHorizontal className="size-4" />
                More filters
                <ChevronDown className="size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-3">
              <div className="grid gap-2">{filterSelects}</div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
            Reset
          </Button>
        </div>
      </div>

      {selected.length >= 2 ? (
        <div className="sticky top-2 z-20 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-ink">{selected.length} selected</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={bulkFulfill.isPending}
                className={orderActionButtonClass("PROCESSING")}
                onClick={() => setConfirmFulfill(true)}
              >
                <Truck className="size-4" />
                {bulkFulfill.isPending ? "Processing…" : "Fulfill · Booked / packed"}
              </Button>
              <BulkIndiaPostBooking
                selectedIds={selected}
                size="sm"
                onQueued={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={bulkFulfill.isPending}
                onClick={() => setSelected([])}
              >
                Clear selection
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={list.items}
        density="compact"
        paginationStyle="numbered"
        fetching={query.isFetching && !query.isLoading}
        loading={query.isLoading && !query.data}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle={shopifyReady ? "No unfulfilled Shopify orders yet" : "No orders match these filters"}
        emptyDescription={
          shopifyReady
            ? "Open orders from the connected store will show up here as soon as they are imported."
            : "Adjust filters or add a manual order."
        }
        emptyAction={
          shopifyReady ? (
            <Button type="button" size="sm" onClick={() => syncShopify.mutate()} disabled={syncShopify.isPending}>
              Sync Shopify
            </Button>
          ) : (
            <Link href="/dashboard/orders/new" className={buttonVariants({ size: "sm" })}>
              Add order
            </Link>
          )
        }
        page={list.page}
        pageSize={pageSize}
        total={list.total}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
        onRowHover={(row) => router.prefetch(`/dashboard/orders/${row.id}`)}
        getRowId={(row) => row.id}
        getRowClassName={(row) => orderStatusRowClass(row.status)}
        mobileView={
          <div className="divide-y divide-border">
            {list.items.map((row) => {
              const checked = selected.includes(row.id);
              return (
                <div
                  key={row.id}
                  className={cn("flex gap-3 px-3 py-3", orderStatusRowClass(row.status))}
                  onClick={() => router.push(`/dashboard/orders/${row.id}`)}
                  onMouseEnter={() => router.prefetch(`/dashboard/orders/${row.id}`)}
                >
                  <div onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={checked}
                      aria-label={`Select ${orderNumber(row)}`}
                      onCheckedChange={(value) => {
                        setSelected((current) =>
                          value ? Array.from(new Set([...current, row.id])) : current.filter((id) => id !== row.id)
                        );
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ink">{orderNumber(row)}</p>
                      <StatusBadge value={row.status} />
                    </div>
                    <p className="truncate text-sm">{customerName(row)}</p>
                    {customerPhone(row) ? (
                      <p className="truncate text-xs text-muted">{customerPhone(row)}</p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {formatCurrency(row.totalAmount ?? row.total_amount, row.currency)}
                      </span>
                      {rowActions(row)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        }
      />
      <Dialog
        open={confirmFulfill}
        onOpenChange={(open) => {
          if (bulkFulfill.isPending) return;
          setConfirmFulfill(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark {selected.length} orders as Booked / packed?
            </DialogTitle>
            <DialogDescription>
              This will update the fulfillment status of the selected orders.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={bulkFulfill.isPending}
              onClick={() => setConfirmFulfill(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={bulkFulfill.isPending || selected.length < 2}
              className={orderActionButtonClass("PROCESSING")}
              onClick={() => bulkFulfill.mutate(selected)}
            >
              {bulkFulfill.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
