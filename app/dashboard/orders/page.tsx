"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { orderStatusRowClass, StatusBadge } from "@/components/dashboard/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  canFulfillOrderAction,
  canMarkDelivered,
  canMarkInTransit,
  canProcessOrderAction,
  customerName,
  isShopifyConnected,
  isWatiConnected,
  itemCount,
  itemNamesPreview,
  itemSummary,
  orderActionButtonClass,
  orderActionLabel,
  orderNumber,
} from "@/lib/dashboard/records";
import { formatCurrency, formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES } from "@/types/domain";
import type { IntegrationsResponse, OrderRecord, Paginated } from "@/types/api";

export default function OrdersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);

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
  const shopify = integrations.data?.shopify;
  const shopifyStatus = (shopify?.status ?? "").toUpperCase();
  const shopifyReady = shopifyStatus === "CONNECTED" || Boolean(shopify?.readyToSync);
  const watiConnected = isWatiConnected(integrations.data);
  const shopifyConnected = isShopifyConnected(integrations.data);
  const stageActionsEnabled = watiConnected || shopifyConnected;

  const query = useQuery({
    queryKey: ["orders", page, debounced, status, source, payment],
    queryFn: () =>
      api<Paginated<OrderRecord>>(`/api/v1/orders?${toSearchParams({
        page,
        pageSize: 20,
        q: debounced,
        status: status === "all" ? undefined : status,
        source: source === "all" ? undefined : source,
        paymentStatus: payment === "all" ? undefined : payment,
      })}`),
    refetchInterval: shopifyReady ? 15000 : false,
  });

  const list = asPaginated<OrderRecord>(query.data, ["orders", "items"]);

  const syncShopify = useMutation({
    mutationFn: () =>
      api<{ imported: number; updated: number; skipped: number; hasMore: boolean }>(
        "/api/v1/integrations/shopify/sync",
        { method: "POST" }
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (result.hasMore) {
        syncShopify.mutate();
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const autoSyncStarted = useRef(false);
  useEffect(() => {
    if (!shopifyReady || autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    syncShopify.mutate();
  }, [shopifyReady, syncShopify]);

  useEffect(() => {
    if (!shopifyReady) return;
    const timer = window.setInterval(() => {
      void api<{ imported: number }>("/api/v1/integrations/shopify/sync", { method: "POST" })
        .then((result) => {
          queryClient.invalidateQueries({ queryKey: ["orders"] });
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
          if (result.imported > 0) {
            window.dispatchEvent(
              new CustomEvent("postbus:new-shopify-orders", {
                detail: [
                  {
                    id: crypto.randomUUID(),
                    title: result.imported === 1 ? "New Shopify order" : `${result.imported} new Shopify orders`,
                    body:
                      result.imported === 1
                        ? "An unfulfilled order just arrived from Shopify."
                        : "Unfulfilled orders just arrived from the connected store.",
                    type: "shopify.order_imported",
                  },
                ],
              })
            );
          }
        })
        .catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [shopifyReady, queryClient]);

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
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function exportCsv() {
    const params = toSearchParams({
      q: debounced,
      status: status === "all" ? undefined : status,
      source: source === "all" ? undefined : source,
      paymentStatus: payment === "all" ? undefined : payment,
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
      id: "actions",
      header: "",
      cell: (row) => {
        const pending = ship.isPending && (ship.variables?.orderIds ?? []).includes(row.id);
        const cancelled = (row.status ?? "").toUpperCase() === "CANCELLED";
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={cn("shrink-0", orderActionButtonClass(row.status))}
                disabled={cancelled || pending}
                onClick={(event) => event.stopPropagation()}
              >
                <Truck className="size-4" />
                {pending ? "Working…" : orderActionLabel(row.status)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem
                disabled={!canProcessOrderAction(row, stageActionsEnabled) || pending}
                onSelect={() => ship.mutate({ orderIds: [row.id], action: "processing" })}
              >
                Processing
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canFulfillOrderAction(row, stageActionsEnabled) || pending}
                onSelect={() => ship.mutate({ orderIds: [row.id], action: "fulfill" })}
              >
                Fulfill · Booked / packed
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canMarkInTransit(row, stageActionsEnabled) || pending}
                onSelect={() => ship.mutate({ orderIds: [row.id], action: "in_transit" })}
              >
                In transit
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canMarkDelivered(row, stageActionsEnabled) || pending}
                onSelect={() => ship.mutate({ orderIds: [row.id], action: "delivered" })}
              >
                Delivered
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
            ? "Unfulfilled Shopify orders import automatically. Status changes send the matching Wati template and update Shopify fulfillment."
            : "Filter, export, and ship the canonical order list."
        }
        actions={
          <>
            {shopifyReady ? (
              <Button
                type="button"
                variant="secondary"
                disabled={syncShopify.isPending}
                onClick={() => syncShopify.mutate()}
              >
                <RefreshCw className={`size-4 ${syncShopify.isPending ? "animate-spin" : ""}`} />
                {syncShopify.isPending ? "Syncing Shopify…" : "Sync Shopify"}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={exportCsv}>
              <Download className="size-4" />
              Export
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={selected.length === 0 || ship.isPending}
              onClick={() => ship.mutate({ orderIds: selected, action: "fulfill" })}
            >
              <Truck className="size-4" />
              Ship selected
            </Button>
            <Link href="/dashboard/orders/new" className={buttonVariants()}>
              <Plus className="size-4" />
              Add order
            </Link>
          </>
        }
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
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={list.items}
        loading={query.isLoading || (shopifyReady && syncShopify.isPending && list.total === 0)}
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
        onSelectionChange={setSelected}
        onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
        getRowId={(row) => row.id}
        getRowClassName={(row) => orderStatusRowClass(row.status)}
      />
    </div>
  );
}
