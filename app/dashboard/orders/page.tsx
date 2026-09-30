"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Download, Plus, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { BulkIndiaPostBooking } from "@/components/bookings/bulk-india-post-booking";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import {
  OrderDateFilter,
  todayOrderRange,
  yesterdayOrderRange,
  type OrderDateFilterValue,
} from "@/components/dashboard/order-date-filter";
import { PageHeader } from "@/components/dashboard/page-header";
import { ServiceToggle } from "@/components/dashboard/service-toggle";
import { orderStatusRowClass, StatusBadge } from "@/components/dashboard/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import type { BulkOrderStatusResult, IndiaPostConfig, IntegrationsResponse, OrderRecord, Paginated } from "@/types/api";

const PARCEL_OPTIONS = [
  { value: "SP_INLAND_PARCEL", label: "SP", title: "Speed Post parcel" },
  { value: "BUSINESS_PARCEL", label: "BP", title: "Business Parcel" },
];

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<OrderDateFilterValue>({ kind: "all" });
  const [confirmFulfill, setConfirmFulfill] = useState(false);

  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    setSearch(q);
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/v1/integrations"),
  });
  const indiaPost = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostConfig>("/api/v1/integrations/india-post"),
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
        pageSize: 20,
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
  });

  const list = asPaginated<OrderRecord>(query.data, ["orders", "items"]);
  const dateCounts = query.data?.counts ?? { all: list.total, today: undefined, yesterday: undefined };

  useEffect(() => {
    if (!syncInFlight) return;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    }, 4000);
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

  const columns: DataTableColumn<OrderRecord>[] = [
    {
      id: "order",
      header: "Order",
      cell: (row) => (
        <Link href={`/dashboard/orders/${row.id}`} className="font-medium hover:text-brand">
          {orderNumber(row)}
        </Link>
      ),
    },
    { id: "customer", header: "Customer", cell: (row) => customerName(row) },
    {
      id: "items",
      header: "Items",
      cell: (row) => {
        const summary = itemSummary(row);
        if (summary === "—") return "—";
        const count = itemCount(row);
        return (
          <div className="max-w-[200px]" title={summary}>
            <p className="font-medium text-ink">{count === 1 ? "1 item" : `${count} items`}</p>
            <p className="truncate text-xs text-muted">{itemNamesPreview(row)}</p>
          </div>
        );
      },
    },
    { id: "source", header: "Source", cell: (row) => <StatusBadge value={row.source} /> },
    { id: "status", header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
    {
      id: "payment",
      header: "Payment",
      cell: (row) => <StatusBadge value={row.paymentStatus ?? row.payment_status} />,
    },
    {
      id: "total",
      header: "Total",
      cell: (row) => formatCurrency(row.totalAmount ?? row.total_amount, row.currency),
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => formatDate(row.createdAt ?? row.created_at, true),
    },
    {
      id: "service",
      header: "Service",
      cell: (row) => {
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
      },
    },
    {
      id: "actions",
      header: "",
      cell: (row) => {
        const pending = ship.isPending && (ship.variables?.orderIds ?? []).includes(row.id);
        const menu = orderStageMenu(row.status);
        const next = menu.next;
        if (menu.hideActions || !next) return null;
        const nextLabel = pending ? "Working…" : next.label;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={cn("shrink-0 transition-all duration-200", orderActionButtonClass(row.status))}
                disabled={pending}
                aria-label={`Next status: ${next.label}`}
                onClick={(event) => event.stopPropagation()}
              >
                <Truck className="size-4" />
                {nextLabel}
                <ChevronDown className="size-3.5 opacity-80" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]" onClick={(event) => event.stopPropagation()}>
              {menu.completed.map((step) => (
                <DropdownMenuLabel
                  key={step.action}
                  className="flex items-center gap-2 py-2 text-sm font-normal text-muted-foreground"
                >
                  <Check className="size-3.5 text-emerald-600" aria-hidden />
                  <span>{step.label}</span>
                  <span className="sr-only">completed</span>
                </DropdownMenuLabel>
              ))}
              <DropdownMenuItem
                className="font-semibold transition-colors duration-200"
                disabled={pending}
                onSelect={() => ship.mutate({ orderIds: [row.id], action: next.action })}
              >
                {next.label}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description={
          shopifyReady
            ? syncInFlight
              ? syncJobStatus === "QUEUED"
                ? "Shopify sync is queued. Orders below are from your workspace and will refresh as imports finish."
                : "Shopify sync is running in the background. Orders below are from your workspace."
              : shopify?.lastSyncAt
                ? `Unfulfilled Shopify orders import in the background. Last synced ${formatDate(shopify.lastSyncAt, true)}.`
                : shopify?.lastError || shopify?.syncJobError
                  ? `Shopify sync last failed: ${shopify.lastError || shopify.syncJobError}`
                  : "Unfulfilled Shopify orders import in the background. Status changes send the matching Wati template and update Shopify fulfillment."
            : "Filter, export, and ship the canonical order list."
        }
        actions={
          <>
            {shopifyReady ? (
              <Button
                type="button"
                variant="secondary"
                disabled={syncShopify.isPending || syncInFlight}
                onClick={() => syncShopify.mutate()}
              >
                <RefreshCw className={`size-4 ${syncShopify.isPending || syncInFlight ? "animate-spin" : ""}`} />
                {syncInFlight ? (syncJobStatus === "QUEUED" ? "Sync queued" : "Syncing…") : "Sync Shopify"}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={exportCsv}>
              <Download className="size-4" />
              Export
            </Button>
            {selected.length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={selected.length === 0 || ship.isPending}
                onClick={() => ship.mutate({ orderIds: selected, action: "fulfill" })}
              >
                <Truck className="size-4" />
                Ship selected
              </Button>
            ) : null}
            <BulkIndiaPostBooking
              selectedIds={selected}
              onQueued={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
            />
            <Link href="/dashboard/orders/new" className={buttonVariants()}>
              <Plus className="size-4" />
              Add order
            </Link>
          </>
        }
      />

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

      <div className="grid gap-3 md:grid-cols-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search order number, customer, phone…"
          className="md:col-span-1"
        />
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(value) => { setSource(value); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {ORDER_SOURCES.map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payment} onValueChange={(value) => { setPayment(value); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="Payment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            {PAYMENT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>{PAYMENT_STATUS_LABELS[item]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected.length >= 2 ? (
        <div className="sticky top-2 z-20 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-ink">{selected.length} selected</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={bulkFulfill.isPending}
                className={orderActionButtonClass("PROCESSING")}
                onClick={() => setConfirmFulfill(true)}
              >
                <Truck className="size-4" />
                {bulkFulfill.isPending ? "Processing…" : "Fulfill · Booked / packed"}
              </Button>
              <BulkIndiaPostBooking
                selectedIds={selected}
                onQueued={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
              />
              <Button
                type="button"
                variant="secondary"
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
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle={shopifyReady ? "No unfulfilled Shopify orders yet" : "No orders match these filters"}
        emptyDescription={
          shopifyReady
            ? "Open orders from the connected store will show up here as soon as they are imported."
            : "Adjust filters or add a manual order."
        }
        emptyAction={
          shopifyReady ? (
            <Button type="button" onClick={() => syncShopify.mutate()} disabled={syncShopify.isPending}>
              Sync Shopify
            </Button>
          ) : (
            <Link href="/dashboard/orders/new" className={buttonVariants()}>
              Add order
            </Link>
          )
        }
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
        getRowId={(row) => row.id}
        getRowClassName={(row) => orderStatusRowClass(row.status)}
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
              disabled={bulkFulfill.isPending}
              onClick={() => setConfirmFulfill(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
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
