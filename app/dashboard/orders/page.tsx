"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid, parseISO, subDays } from "date-fns";
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  Link2,
  MoreHorizontal,
  Plus,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { OrderDimensionBadge } from "@/components/orders/order-dimension-badge";
import { ShopifyPaymentConfirm } from "@/components/orders/shopify-payment-confirm";
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
import { orderStatusBadgeValue, orderStatusRowClass, StatusBadge } from "@/components/dashboard/status-badge";
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
  committedSearchChanged,
  ordersListHref,
  parseOrdersPageParam,
  patchOrdersListSearchParams,
  selectionAfterFilterChange,
} from "@/lib/dashboard/orders-list-query";
import {
  asPaginated,
  customerName,
  customerPhone,
  itemCount,
  itemNamesPreview,
  itemSummary,
  orderActionButtonClass,
  orderNumber,
  orderStageMenu,
} from "@/lib/dashboard/records";
import { toggleRowSelection } from "@/lib/dashboard/row-selection";
import { formatCurrency, formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import {
  parcelServiceCode,
  resolveOrderBookingService,
  shipmentServiceLocked,
} from "@/modules/india-post/booking-service";
import { lowBarcodeServices } from "@/modules/india-post/barcode";
import { parcelServiceToggleOptions, savedParcelContracts } from "@/modules/india-post/contracts";
import { isIndiaPostBookingInFlight } from "@/modules/india-post/booking-status";
import { tariffListState, type TariffListState } from "@/modules/india-post/tariff-list";
import type { TariffQuote } from "@/modules/india-post/tariff-contract";
import { ORDER_SOURCE_LABELS, ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from "@/types/domain";
import type { BulkOrderStatusResult, DashboardKpis, IndiaPostConfig, IntegrationsResponse, OrderRecord, Paginated } from "@/types/api";

const COLUMN_STORAGE = "postbus.orders.columns";
const WIDTH_STORAGE = "postbus.orders.column-widths";
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_COLUMNS = {
  items: true,
  source: true,
  dimensions: true,
  payment: true,
  created: true,
  service: true,
};

type OptionalColumn = keyof typeof DEFAULT_COLUMNS;

const COLUMN_LABELS: Record<OptionalColumn, string> = {
  items: "Items",
  source: "Source",
  dimensions: "Parcel",
  payment: "Payment",
  created: "Created",
  service: "Service",
};

const FILTER_SELECT_CLASS = "h-8 shadow-none";

type TariffCapabilities = {
  enabled: boolean;
  organizationId: string;
  senderChoices: Array<{ id: "pickup" | "dropoff"; label: string; pincode: string }>;
  defaults?: {
    weightGrams?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
  } | null;
};

type TariffProgress = {
  key: string;
  status: "calculating" | "success" | "error";
  amount?: number;
};

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
  const urlQ = searchParams.get("q") ?? "";
  const page = parseOrdersPageParam(searchParams.get("page"));
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState(urlQ);
  const [debounced, setDebounced] = useState(urlQ.trim());
  const committedSearchRef = useRef(urlQ.trim());
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<OrderDateFilterValue>({ kind: "all" });
  const [confirmFulfill, setConfirmFulfill] = useState(false);
  const [columnsReady, setColumnsReady] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_COLUMNS);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [tariffProgress, setTariffProgress] = useState<Record<string, TariffProgress>>({});
  const attemptedTariffs = useRef(new Set<string>());

  const tableLayout = useQuery({
    queryKey: ["ui-table-layout", "orders"],
    queryFn: () => api<{ tableKey: string; columnWidths: Record<string, number> }>("/api/v1/ui/table-layouts/orders"),
    staleTime: 60_000,
  });
  const saveTableLayout = useMutation({
    mutationFn: (widths: Record<string, number>) =>
      api<{ tableKey: string; columnWidths: Record<string, number> }>("/api/v1/ui/table-layouts/orders", {
        method: "PUT",
        body: JSON.stringify({ columnWidths: widths }),
      }),
  });

  const kpiWindow = useMemo(() => {
    const now = new Date();
    return {
      from: format(subDays(now, 29), "yyyy-MM-dd"),
      to: format(now, "yyyy-MM-dd"),
    };
  }, []);

  const replaceListParams = useCallback(
    (patch: { page?: number; q?: string | null }) => {
      const next = patchOrdersListSearchParams(searchParams, patch);
      router.replace(ordersListHref(next), { scroll: false });
    },
    [router, searchParams]
  );

  const applyFilterChange = useCallback(() => {
    setSelected(selectionAfterFilterChange());
    replaceListParams({ page: 1 });
  }, [replaceListParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(urlQ), 0);
    return () => window.clearTimeout(timer);
  }, [urlQ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setDebounced(next);
      if (committedSearchChanged(committedSearchRef.current, next)) {
        committedSearchRef.current = next;
        setSelected(selectionAfterFilterChange());
        replaceListParams({ page: 1, q: next });
        return;
      }
      committedSearchRef.current = next;
    }, 300);
    return () => window.clearTimeout(timer);
  }, [replaceListParams, search]);

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
    if (!tableLayout.isSuccess) return;
    const fromDb = tableLayout.data.columnWidths ?? {};
    if (Object.keys(fromDb).length > 0) {
      setColumnWidths(fromDb);
      return;
    }
    try {
      const storedWidths = window.localStorage.getItem(WIDTH_STORAGE);
      if (!storedWidths) return;
      const parsed = JSON.parse(storedWidths) as Record<string, unknown>;
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
      }
      if (Object.keys(next).length === 0) return;
      setColumnWidths(next);
      saveTableLayout.mutate(next);
      window.localStorage.removeItem(WIDTH_STORAGE);
    } catch {
      /* ignore */
    }
  }, [tableLayout.isSuccess, tableLayout.data]);

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
  const lowBarcodes = useMemo(() => lowBarcodeServices(indiaPost.data), [indiaPost.data]);
  const barcodeWarningDismissed = useRef(false);
  const [barcodeWarningOpen, setBarcodeWarningOpen] = useState(false);
  useEffect(() => {
    if (barcodeWarningDismissed.current || lowBarcodes.length === 0) return;
    setBarcodeWarningOpen(true);
  }, [lowBarcodes]);
  const tariffCapabilities = useQuery({
    queryKey: ["tariff-capabilities", "orders-list"],
    queryFn: () => api<TariffCapabilities>("/api/v1/india-post/tariff-capabilities", { cache: "no-store" }),
    retry: false,
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
    refetchInterval: (current) => {
      const rows = asPaginated<OrderRecord>(current.state.data, ["orders", "items"]).items;
      return rows.some((row) => isIndiaPostBookingInFlight(row.shipment?.status)) ? 3_000 : false;
    },
  });

  const list = asPaginated<OrderRecord>(query.data, ["orders", "items"]);
  const dateCounts = query.data?.counts ?? { all: list.total, today: undefined, yesterday: undefined };
  const tariffSender = tariffCapabilities.data?.senderChoices.find((choice) => choice.id === "pickup")
    ?? tariffCapabilities.data?.senderChoices[0];
  const tariffRows = useMemo(() => {
    const states = new Map<string, TariffListState>();
    const allowedServices = savedParcelContracts(indiaPost.data).map((contract) => contract.serviceCode);
    for (const row of list.items) {
      const service = resolveOrderBookingService({
        orderService: row.indiaPostService ?? row.india_post_service,
        workspaceOverride: indiaPost.data?.bookingServiceOverride,
        defaultService: indiaPost.data?.defaultServiceCode,
        allowedServices,
      });
      states.set(row.id, tariffListState(row, {
        ...tariffCapabilities.data?.defaults,
        service,
        sourcePincode: tariffSender?.pincode,
      }));
    }
    return states;
  }, [indiaPost.data, list.items, tariffCapabilities.data?.defaults, tariffSender?.pincode]);
  const tariffQueueSignature = Array.from(tariffRows.entries())
    .filter(([, state]) => state.status === "quote")
    .map(([id, state]) => `${id}:${state.status === "quote" ? state.key : ""}`)
    .join(",");

  useEffect(() => {
    if (!tariffCapabilities.data?.enabled || !tariffSender) return;
    const jobs = Array.from(tariffRows.entries()).flatMap(([orderId, state]) => {
      if (state.status !== "quote") return [];
      const attemptKey = `${orderId}:${state.key}`;
      if (attemptedTariffs.current.has(attemptKey)) return [];
      attemptedTariffs.current.add(attemptKey);
      return [{ orderId, state, attemptKey }];
    });
    if (!jobs.length) return;
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        setTariffProgress((current) => ({
          ...current,
          [job.orderId]: { key: job.state.key, status: "calculating" },
        }));
        try {
          const quote = await api<TariffQuote>(`/api/v1/orders/${encodeURIComponent(job.orderId)}/tariff-quote`, {
            method: "POST",
            body: JSON.stringify({ senderOffice: tariffSender.id }),
          });
          queryClient.setQueriesData<Paginated<OrderRecord>>({ queryKey: ["orders"] }, (current) => current ? {
            ...current,
            items: current.items.map((row) => row.id === job.orderId ? {
              ...row,
              indiaPostEstimateAmount: quote.estimatedTotal,
              india_post_estimate_amount: quote.estimatedTotal,
              indiaPostEstimatedAt: quote.calculatedAt,
              india_post_estimated_at: quote.calculatedAt,
              indiaPostEstimateKey: job.state.key,
              india_post_estimate_key: job.state.key,
            } : row),
          } : current);
          setTariffProgress((current) => ({
            ...current,
            [job.orderId]: { key: job.state.key, status: "success", amount: quote.estimatedTotal },
          }));
        } catch {
          setTariffProgress((current) => ({
            ...current,
            [job.orderId]: { key: job.state.key, status: "error" },
          }));
        }
      }
    };
    void Promise.all([worker(), worker()]);
  }, [queryClient, tariffCapabilities.data?.enabled, tariffQueueSignature, tariffRows, tariffSender]);

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
    onSuccess: (_data, variables) => {
      queryClient.setQueriesData<Paginated<OrderRecord>>({ queryKey: ["orders"] }, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                row.id === variables.orderId
                  ? {
                      ...row,
                      indiaPostService: variables.service,
                      india_post_service: variables.service,
                      indiaPostEstimateKey: null,
                      india_post_estimate_key: null,
                    }
                  : row
              ),
            }
          : current
      );
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(
        variables.service === "BUSINESS_PARCEL"
          ? "Switched to Business Parcel."
          : "Switched to Speed Post Parcel Domestic."
      );
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
    committedSearchRef.current = "";
    setStatus("all");
    setSource("all");
    setPayment("all");
    setDateFilter({ kind: "all" });
    setSelected(selectionAfterFilterChange());
    replaceListParams({ page: 1, q: "" });
  }

  function toggleColumn(key: OptionalColumn, next: boolean) {
    setVisibleColumns((current) => ({ ...current, [key]: next }));
  }

  function rowServiceToggle(row: OrderRecord) {
    const allowedServices = savedParcelContracts(indiaPost.data).map((contract) => contract.serviceCode);
    const effective = resolveOrderBookingService({
      orderService: row.indiaPostService ?? row.india_post_service,
      workspaceOverride: indiaPost.data?.bookingServiceOverride,
      defaultService: indiaPost.data?.defaultServiceCode,
      allowedServices,
    });
    const locked = shipmentServiceLocked(row.shipment?.status);
    const pending = setService.isPending && setService.variables?.orderId === row.id;
    return (
      <ServiceToggle
        label={`India Post service for ${orderNumber(row)}`}
        value={parcelServiceCode(effective) ?? ""}
        options={parcelServiceToggleOptions(indiaPost.data)}
        disabled={locked || pending}
        onChange={(service) => {
          if (service !== parcelServiceCode(effective)) {
            setService.mutate({ orderId: row.id, service });
          }
        }}
      />
    );
  }

  function rowActions(row: OrderRecord) {
    const pending = ship.isPending && (ship.variables?.orderIds ?? []).includes(row.id);
    const menu = orderStageMenu(row.status, row.source, row.paymentStatus ?? row.payment_status);
    const next = menu.next;
    return (
      <div className="inline-flex w-full items-center justify-center gap-1" onClick={(event) => event.stopPropagation()}>
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
      className: "w-[4.75rem] whitespace-nowrap",
      resizable: true,
      minWidth: 64,
      maxWidth: 280,
      cell: (row) => (
        <Link href={`/dashboard/orders/${row.id}`} className="font-medium hover:text-brand">
          {orderNumber(row)}
        </Link>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      className: visibleColumns.items ? "w-[11rem]" : "min-w-0",
      resizable: true,
      fill: !visibleColumns.items,
      minWidth: 96,
      maxWidth: 420,
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
            className: "min-w-0 w-full whitespace-normal",
            resizable: true,
            fill: true,
            minWidth: 120,
            maxWidth: 560,
            cell: (row: OrderRecord) => {
              const summary = itemSummary(row);
              if (summary === "—") return "—";
              const count = itemCount(row);
              const preview = itemNamesPreview(row);
              return (
                <p className="line-clamp-2 min-w-0 break-words text-[12px] leading-snug" title={summary}>
                  <span className="font-medium text-ink">
                    {count === 1 ? "1 item" : `${count} items`}
                  </span>
                  {preview ? <span className="text-muted"> · {preview}</span> : null}
                </p>
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
            className: "w-16 px-1.5 text-center tracking-normal",
            cell: (row: OrderRecord) => (
              <div className="flex justify-center">
                <StatusBadge value={row.source} />
              </div>
            ),
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    {
      id: "status",
      header: "Status",
      className: "w-[6.75rem] whitespace-nowrap",
      cell: (row) => <StatusBadge value={orderStatusBadgeValue(row.status)} />,
    },
    ...(visibleColumns.dimensions
      ? [
          {
            id: "dimensions",
            header: "Parcel",
            className: "w-[7.5rem] px-2 whitespace-nowrap",
            cell: (row: OrderRecord) => <OrderDimensionBadge order={row} />,
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    ...(visibleColumns.payment
      ? [
          {
            id: "payment",
            header: "Payment",
            className: "w-[6.25rem] overflow-visible whitespace-nowrap",
            cell: (row: OrderRecord) => <ShopifyPaymentConfirm order={row} />,
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    {
      id: "total",
      header: "Total",
      className: "w-[4.75rem] whitespace-nowrap",
      cell: (row) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatCurrency(row.totalAmount ?? row.total_amount, row.currency)}
        </span>
      ),
    },
    {
      id: "estimatedShipping",
      header: "Est. shipping",
      className: "w-[8.5rem] whitespace-nowrap",
      cell: (row) => {
        const state = tariffRows.get(row.id);
        const progress = tariffProgress[row.id];
        if (state?.status === "missing" || state?.status === "blocked") {
          return <span className="text-xs font-medium text-amber-700" title={state.warning}>{state.warning}</span>;
        }
        if (state?.status === "quote" && progress?.key === state.key) {
          if (progress.status === "calculating") return <span className="text-xs text-muted">Calculating…</span>;
          if (progress.status === "error") return <span className="text-xs font-medium text-amber-700">Unavailable</span>;
          if (progress.status === "success" && progress.amount != null) {
            return <span className="whitespace-nowrap tabular-nums">{formatCurrency(progress.amount, "INR")}</span>;
          }
        }
        const amount = row.indiaPostEstimateAmount ?? row.india_post_estimate_amount;
        return state?.status === "quote" ? (
          <span className="text-xs text-muted">Queued…</span>
        ) : amount == null ? (
          <span className="text-xs text-muted">—</span>
        ) : (
          <span className="whitespace-nowrap tabular-nums" title="Latest India Post pre-booking estimate">
            {formatCurrency(amount, "INR")}
          </span>
        );
      },
    },
    ...(visibleColumns.created
      ? [
          {
            id: "created",
            header: "Created",
            className: "w-[5.5rem] whitespace-nowrap",
            cell: (row: OrderRecord) => <CreatedCell value={row.createdAt ?? row.created_at} />,
          } satisfies DataTableColumn<OrderRecord>,
        ]
      : []),
    {
      id: "actions",
      header: "Actions",
      hug: true,
      width: 140,
      className: "overflow-visible whitespace-nowrap px-1.5 text-center",
      cell: (row) => rowActions(row),
    },
  ];

  const filterSelects = (
    <>
      <Select value={status} onValueChange={(value) => { setStatus(value); applyFilterChange(); }}>
        <SelectTrigger className={FILTER_SELECT_CLASS}><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {ORDER_STATUSES.map((item) => (
            <SelectItem key={item} value={item}>
              {item === "READY" ? "Unfulfilled" : item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={source} onValueChange={(value) => { setSource(value); applyFilterChange(); }}>
        <SelectTrigger className={FILTER_SELECT_CLASS}><SelectValue placeholder="Source" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {ORDER_SOURCES.map((item) => (
            <SelectItem key={item} value={item}>{ORDER_SOURCE_LABELS[item]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={payment} onValueChange={(value) => { setPayment(value); applyFilterChange(); }}>
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
    <div className="min-w-0 space-y-3">
      <PageHeader
        title="Orders"
        description={description}
        className="min-w-0"
        actionsClassName="w-full justify-start sm:w-auto sm:justify-end"
        icon={
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-brand sm:size-9 sm:rounded-xl">
            <ShoppingBag className="size-4 sm:size-5" />
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
                  <Image
                    src="/images/shopify-icon.png"
                    alt=""
                    width={16}
                    height={16}
                    className={`size-4 object-contain ${syncShopify.isPending || syncInFlight ? "animate-pulse" : ""}`}
                  />
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
            <Link href="/dashboard/orders/customer-links" className={buttonVariants({ variant: "secondary", size: "xs" })}>
              <Link2 className="size-4" />
              Customer order link
            </Link>
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
          applyFilterChange();
        }}
      />

      <div className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-2 sm:p-2.5">
        <OrderDateFilter
          value={dateFilter}
          counts={{
            all: dateCounts.all,
            today: dateCounts.today,
            yesterday: dateCounts.yesterday,
          }}
          onChange={(next) => {
            setDateFilter(next);
            applyFilterChange();
          }}
        />
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order number, customer, phone…"
            className="h-8 w-full min-w-0 shadow-none lg:max-w-xs"
          />
          <div className="hidden min-w-0 flex-1 grid-cols-3 gap-2 lg:grid">
            {filterSelects}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="sm" className="h-8 lg:hidden">
                  <SlidersHorizontal className="size-4" />
                  Filters
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-3">
                <div className="grid gap-2">{filterSelects}</div>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="sm" className="h-8">
                  <Columns3 className="size-4" />
                  <span className="hidden sm:inline">Columns</span>
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
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </div>
      </div>

      {selected.length > 0 ? (
        <div className="sticky top-2 z-20 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-ink">
              {selected.length === 1 ? "1 selected" : `${selected.length} selected`}
            </p>
            <div className="flex flex-wrap gap-2">
              {selected.length >= 2 ? (
                <>
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
                </>
              ) : null}
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
        fetching={(query.isFetching && !query.isLoading) || query.isPlaceholderData}
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
        page={page}
        pageSize={pageSize}
        total={list.total}
        onPageChange={(next) => replaceListParams({ page: next })}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(size) => {
          setPageSize(size);
          replaceListParams({ page: 1 });
        }}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
        onRowHover={(row) => router.prefetch(`/dashboard/orders/${row.id}`)}
        getRowId={(row) => row.id}
        getRowClassName={(row) => orderStatusRowClass(row.status)}
        columnWidths={columnWidths}
        onColumnWidthsChange={(widths) => {
          setColumnWidths(widths);
          saveTableLayout.mutate(widths);
        }}
        stackBelow="lg"
        fitContainer
        mobileView={
          <div className="divide-y divide-border">
            {list.items.map((row) => {
              const checked = selected.includes(row.id);
              return (
                <div
                  key={row.id}
                  className={cn("flex gap-2.5 px-3 py-2.5", orderStatusRowClass(row.status))}
                  onClick={() => router.push(`/dashboard/orders/${row.id}`)}
                  onMouseEnter={() => router.prefetch(`/dashboard/orders/${row.id}`)}
                >
                  <div onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={checked}
                      aria-label={`Select ${orderNumber(row)}`}
                      onCheckedChange={(value) => {
                        setSelected((current) => toggleRowSelection(current, row.id, value === true));
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{orderNumber(row)}</p>
                        <p className="truncate text-sm">{customerName(row)}</p>
                        {customerPhone(row) ? (
                          <p className="truncate text-xs text-muted">{customerPhone(row)}</p>
                        ) : null}
                      </div>
                      <StatusBadge value={orderStatusBadgeValue(row.status)} />
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <StatusBadge value={row.source} />
                      <OrderDimensionBadge order={row} />
                      <ShopifyPaymentConfirm order={row} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
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
        open={barcodeWarningOpen}
        onOpenChange={(open) => {
          if (!open) barcodeWarningDismissed.current = true;
          setBarcodeWarningOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Low barcode series</DialogTitle>
            <DialogDescription>
              {lowBarcodes
                .map((service) => `${service.label} has ${service.left} barcodes left.`)
                .join(" ")}{" "}
              Add a barcode series. Otherwise you can’t book this shipment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                barcodeWarningDismissed.current = true;
                setBarcodeWarningOpen(false);
              }}
            >
              Close
            </Button>
            <Link
              href="/dashboard/integrations/india-post"
              className={buttonVariants({ size: "sm" })}
              onClick={() => {
                barcodeWarningDismissed.current = true;
              }}
            >
              Add barcode
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
