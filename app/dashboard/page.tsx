"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { ArrowDownRight, ArrowUpRight, Package, Plug, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  asPaginated,
  customerName,
  kpiChange,
  kpiValue,
  orderNumber,
  pipelineStages,
} from "@/lib/dashboard/records";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import type { DashboardKpis, DashboardPipeline, OrderRecord, Paginated } from "@/types/api";

const RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
];

const KPI_DEFS = [
  { key: "orders" as const, label: "Orders", fallback: ["orders"] },
  { key: "readyToShip" as const, label: "Ready to ship", fallback: ["ready", "readyToShip"] },
  { key: "booked" as const, label: "Booked", fallback: ["booked"] },
  { key: "inTransit" as const, label: "In transit", fallback: ["inTransit", "in_transit"] },
  { key: "delivered" as const, label: "Delivered", fallback: ["delivered"] },
  { key: "failed" as const, label: "Failed", fallback: ["failed"] },
];

function greeting(name?: string | null) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name?.split(" ")[0];
  return first ? `${hello}, ${first}` : hello;
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [range, setRange] = useState("30");
  const [selected, setSelected] = useState<string[]>([]);

  const window = useMemo(() => {
    const days = RANGES.find((item) => item.id === range)?.days ?? 30;
    return {
      from: format(subDays(new Date(), days - 1), "yyyy-MM-dd"),
      to: format(new Date(), "yyyy-MM-dd"),
    };
  }, [range]);

  const kpis = useQuery({
    queryKey: ["dashboard-kpis", window],
    queryFn: () => api<DashboardKpis>(`/api/v1/dashboard/kpis?${toSearchParams(window)}`),
  });

  const pipeline = useQuery({
    queryKey: ["dashboard-pipeline", window],
    queryFn: () =>
      api<DashboardPipeline>(`/api/v1/dashboard/pipeline?${toSearchParams(window)}`),
  });

  const orders = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () =>
      api<Paginated<OrderRecord> | { items: OrderRecord[] }>(
        `/api/v1/orders?${toSearchParams({ page: 1, pageSize: 8 })}`
      ),
  });

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<{ shopify?: { status?: string } }>("/api/v1/integrations"),
  });

  const recent = asPaginated<OrderRecord>(orders.data, ["orders", "items"]);
  const stages = pipelineStages(pipeline.data);
  const shopifyStatus = (
    integrations.data?.shopify?.status ??
    (integrations.data as { items?: Array<{ provider?: string; status?: string }> } | undefined)?.items?.find(
      (item) => item.provider?.toLowerCase().includes("shopify")
    )?.status
  )?.toUpperCase();
  const shopifyConnected = shopifyStatus === "CONNECTED";
  const readyCount =
    kpiValue(kpis.data, "readyToShip", ["ready"]) ?? kpiValue(kpis.data, "ready") ?? 0;

  const shipSelected = useMutation({
    mutationFn: (orderIds: string[]) =>
      api("/api/v1/shipments", {
        method: "POST",
        body: JSON.stringify({ orderIds }),
      }),
    onSuccess: () => {
      toast.success("Selected orders were queued for shipping.");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncShopify = useMutation({
    mutationFn: () => api("/api/v1/integrations/shopify/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Shopify sync queued.");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: DataTableColumn<OrderRecord>[] = [
    {
      id: "order",
      header: "Order",
      cell: (row) => (
        <Link href={`/dashboard/orders/${row.id}`} className="font-medium text-ink hover:text-brand">
          {orderNumber(row)}
        </Link>
      ),
    },
    { id: "customer", header: "Customer", cell: (row) => customerName(row) },
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
      cell: (row) => formatDate(row.createdAt ?? row.created_at),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={greeting(me.data?.user.fullName)}
        description={`${me.data?.organization?.name ?? "Your workspace"} · ${format(new Date(), "EEEE, d MMMM yyyy")}`}
        actions={
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Ready to ship</CardTitle>
            <CardDescription>
              {kpis.isError
                ? "Could not load ready-to-ship volume."
                : `${formatNumber(readyCount)} orders are waiting to be booked.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={selected.length === 0 || shipSelected.isPending}
              onClick={() => shipSelected.mutate(selected)}
            >
              <Truck className="size-4" />
              Ship selected
            </Button>
            {shopifyConnected ? (
              <Button
                type="button"
                variant="secondary"
                disabled={syncShopify.isPending}
                onClick={() => syncShopify.mutate()}
              >
                <RefreshCw className="size-4" />
                Sync Shopify
              </Button>
            ) : (
              <Link href="/dashboard/integrations" className={buttonVariants({ variant: "secondary" })}>
                <Plug className="size-4" />
                Connect Shopify
              </Link>
            )}
          </div>
        </CardHeader>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {KPI_DEFS.map((def) => {
          const value = kpiValue(kpis.data, def.key, def.fallback);
          const change = kpiChange(kpis.data, def.key);
          return (
            <Card key={def.key}>
              <CardHeader>
                <CardDescription>{def.label}</CardDescription>
                <CardTitle className="text-3xl">
                  {kpis.isLoading ? "…" : kpis.isError ? "—" : formatNumber(value)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {change === null ? (
                  <p className="text-sm text-muted">No comparison for this window</p>
                ) : (
                  <p className="flex items-center gap-1 text-sm text-muted">
                    {change >= 0 ? (
                      <ArrowUpRight className="size-4 text-success" />
                    ) : (
                      <ArrowDownRight className="size-4 text-error" />
                    )}
                    {change >= 0 ? "+" : ""}
                    {change}% vs previous period
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-ink">Pipeline</h2>
        {pipeline.isError ? (
          <EmptyState
            icon={Package}
            title="Pipeline unavailable"
            description={pipeline.error instanceof Error ? pipeline.error.message : "Try again shortly."}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(pipeline.isLoading ? Array.from({ length: 4 }, () => null) : stages).map((stage, index) => (
              <Card key={stage?.status ?? stage?.key ?? index}>
                <CardHeader>
                  <CardDescription>
                    {stage ? stage.label ?? stage.status ?? stage.key ?? "Stage" : "Loading"}
                  </CardDescription>
                  <CardTitle className="text-2xl">
                    {stage ? formatNumber(stage.count) : "…"}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
            {!pipeline.isLoading && stages.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No pipeline data"
                description="Orders will appear here as they move through shipping."
                className="sm:col-span-2 lg:col-span-4"
              />
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Recent orders</h2>
          <Link href="/dashboard/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            View all
          </Link>
        </div>
        <DataTable
          columns={columns}
          data={recent.items}
          loading={orders.isLoading}
          error={orders.error instanceof Error ? orders.error : null}
          emptyTitle="No orders yet"
          emptyDescription="Import from Shopify or add a manual order to get started."
          emptyAction={
            <Link href="/dashboard/orders/new" className={buttonVariants()}>
              Add order
            </Link>
          }
          selectable
          onSelectionChange={setSelected}
          onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
          getRowId={(row) => row.id}
        />
      </section>
    </div>
  );
}
