"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, MoreHorizontal, PackageX, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { IndiaPostRouting } from "@/components/dashboard/india-post-routing";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate, formatRelative } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { indiaPostPublicTrackingUrl } from "@/modules/india-post/barcode";
import { NDR_VISIBLE_SYNC_MAX } from "@/modules/ndr-rto/schema";
import { SHIPMENT_STATUSES, NDR_BUCKETS, type MemberRole, type NdrBucket } from "@/types/domain";
import type { NdrSummary, Paginated, ShipmentRecord, TrackingEvent } from "@/types/api";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";

const BUCKETS: Array<{ id: "all" | NdrBucket; label: string; summary?: keyof NdrSummary }> = [
  { id: "all", label: "All" },
  { id: "DELIVERED", label: "Delivered", summary: "delivered" },
  { id: "OUT_FOR_DELIVERY", label: "Out for Delivery", summary: "outForDelivery" },
  { id: "DELIVERED_TODAY", label: "Delivered Today", summary: "deliveredToday" },
  { id: "NDR", label: "NDR", summary: "ndr" },
  { id: "RTO", label: "RTO", summary: "rto" },
  { id: "RTO_IN_TRANSIT", label: "RTO In Transit", summary: "rtoInTransit" },
  { id: "RTO_DELIVERED", label: "RTO Delivered", summary: "rtoDelivered" },
];

type NdrRow = ShipmentRecord & Record<string, unknown>;

function text(row: NdrRow, camel: string, snake: string) {
  const value = row[camel] ?? row[snake];
  return typeof value === "string" && value.trim() ? value : null;
}

function badgeValue(row: NdrRow) {
  const operational = text(row, "operationalStatus", "operational_status");
  if (operational === "RTO_IN_TRANSIT" || operational === "RTO_DELIVERED") return operational;
  return row.status;
}

function isReturn(row: NdrRow) {
  const operational = text(row, "operationalStatus", "operational_status");
  return row.status === "RTO" || operational === "RTO" || operational === "RTO_IN_TRANSIT" || operational === "RTO_DELIVERED";
}

function trackingId(row: NdrRow) {
  return text(row, "trackingNumber", "tracking_number") ?? row.barcode ?? "";
}

function isNdrRow(row: NdrRow) {
  return badgeValue(row) === "NDR" || Boolean(text(row, "ndrReason", "ndr_reason"));
}

function parseBucket(value: string | null): "all" | NdrBucket {
  if (value && (NDR_BUCKETS as readonly string[]).includes(value)) return value as NdrBucket;
  return "all";
}

export default function NdrRtoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const me = useMe();
  const canSync = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "shipments.write");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [bucket, setBucket] = useState<"all" | NdrBucket>(() => parseBucket(searchParams.get("bucket")));
  const [status, setStatus] = useState("all");
  const [event, setEvent] = useState("");
  const [customer, setCustomer] = useState("");
  const [orderId, setOrderId] = useState("");
  const [tracking, setTracking] = useState("");
  const [pincode, setPincode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [routingId, setRoutingId] = useState<string | null>(null);

  useEffect(() => {
    setBucket(parseBucket(searchParams.get("bucket")));
  }, [searchParams]);

  function applyBucket(next: "all" | NdrBucket) {
    setBucket(next);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("bucket");
    else params.set("bucket", next);
    const query = params.toString();
    router.replace(query ? `/dashboard/ndr-rto?${query}` : "/dashboard/ndr-rto");
  }

  function clearFilters() {
    setSearch("");
    setDebounced("");
    setStatus("all");
    setEvent("");
    setCustomer("");
    setOrderId("");
    setTracking("");
    setPincode("");
    setFrom("");
    setTo("");
    setPage(1);
    applyBucket("all");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const summary = useQuery({
    queryKey: ["ndr-rto-summary"],
    queryFn: () => api<NdrSummary>("/api/v1/ndr-rto/summary"),
  });

  const routing = useQuery({
    queryKey: ["shipment", routingId],
    queryFn: () => api<ShipmentRecord & { events?: TrackingEvent[] }>(`/api/v1/shipments/${routingId}`),
    enabled: Boolean(routingId),
  });

  const list = useQuery({
    queryKey: ["ndr-rto", page, debounced, bucket, status, event, customer, orderId, tracking, pincode, from, to],
    queryFn: () =>
      api<Paginated<NdrRow>>(
        `/api/v1/ndr-rto?${toSearchParams({
          page,
          pageSize: 20,
          q: debounced,
          bucket: bucket === "all" ? undefined : bucket,
          status: status === "all" ? undefined : status,
          event,
          customer,
          orderId,
          trackingId: tracking,
          pincode,
          from,
          to,
        })}`
      ),
    refetchInterval: 20_000,
  });

  const sync = useMutation({
    mutationFn: (shipmentId: string) => api(`/api/v1/ndr-rto/${shipmentId}/sync`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Tracking refreshed.");
      queryClient.invalidateQueries({ queryKey: ["ndr-rto"] });
      queryClient.invalidateQueries({ queryKey: ["ndr-rto-summary"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = asPaginated<NdrRow>(list.data, ["items"]);
  const visibleIds = useMemo(
    () =>
      rows.items
        .filter((row) => Boolean(trackingId(row)))
        .map((row) => String(row.id))
        .slice(0, NDR_VISIBLE_SYNC_MAX),
    [rows.items]
  );
  const autoSynced = useRef<string>("");

  const syncVisible = useMutation({
    mutationFn: (shipmentIds: string[]) =>
      api<{ tracked: number; matched: number }>("/api/v1/ndr-rto/sync-visible", {
        method: "POST",
        body: JSON.stringify({ shipmentIds }),
      }),
    onSuccess: (result) => {
      const tracked = result.tracked ?? visibleIds.length;
      const matched = result.matched ?? 0;
      toast.success(
        matched
          ? `Updated India Post tracking for ${matched} of ${tracked} shipment${tracked === 1 ? "" : "s"}.`
          : `India Post responded for ${tracked} shipment${tracked === 1 ? "" : "s"}, with no new scan events.`
      );
      queryClient.invalidateQueries({ queryKey: ["ndr-rto"] });
      queryClient.invalidateQueries({ queryKey: ["ndr-rto-summary"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const visibleKey = visibleIds.join(",");

  useEffect(() => {
    if (!canSync || list.isLoading || list.isError || !visibleIds.length) return;
    if (autoSynced.current === visibleKey) return;
    autoSynced.current = visibleKey;
    syncVisible.mutate(visibleIds);
    // Mutation identity is not a load trigger — only the visible AWB set is.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid CEPT loops from mutation object identity
  }, [canSync, list.isError, list.isLoading, visibleKey]);
  const filtersActive = Boolean(
    debounced || event || customer || orderId || tracking || pincode || from || to || status !== "all" || bucket !== "all"
  );

  const columns: DataTableColumn<NdrRow>[] = [
    {
      id: "order",
      header: "Order ID",
      cell: (row) => {
        const id = text(row, "orderId", "order_id");
        const number = text(row, "orderNumber", "order_number") ?? "—";
        if (!id) return number;
        return (
          <Link href={`/dashboard/orders/${id}`} className="font-medium hover:text-brand" onClick={(event) => event.stopPropagation()}>
            {number}
          </Link>
        );
      },
    },
    {
      id: "tracking",
      header: "Tracking ID",
      cell: (row) => {
        const value = trackingId(row);
        if (!value) return "—";
        return (
          <span className="inline-flex items-center gap-1">
            <span className="font-medium">{value}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Copy tracking ID ${value}`}
              onClick={async (event) => {
                event.stopPropagation();
                await navigator.clipboard.writeText(value);
                toast.success("Tracking ID copied.");
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </span>
        );
      },
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => {
        const customer = row.customer as { name?: string; phone?: string } | null;
        const place = [text(row, "shippingCity", "shipping_city"), text(row, "shippingPincode", "shipping_pincode")]
          .filter(Boolean)
          .join(" ");
        return (
          <div>
            <p className="font-medium">{customer?.name || "—"}</p>
            <p className="text-xs text-muted">{[customer?.phone, place].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        );
      },
    },
    {
      id: "event",
      header: "Event",
      cell: (row) =>
        text(row, "lastEventDescription", "last_event_description") ??
        text(row, "lastEventCode", "last_event_code") ??
        (text(row, "lastTrackedAt", "last_tracked_at") ? "No India Post scan yet" : "Waiting for India Post"),
    },
    {
      id: "scan",
      header: "Last Scan",
      cell: (row) => {
        const office = text(row, "lastScanOffice", "last_scan_office");
        const when = formatDate(text(row, "lastEventAt", "last_event_at"), true);
        const lookedUp = formatRelative(text(row, "lastTrackedAt", "last_tracked_at"));
        if (!office && when === "—" && lookedUp === "—") return "—";
        return (
          <div>
            <p>{office || (when !== "—" ? when : "No scan location")}</p>
            <p className="text-xs text-muted">
              {[when !== "—" ? when : null, lookedUp !== "—" ? `Looked up ${lookedUp}` : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
        );
      },
    },
    {
      id: "reason",
      header: "NDR / RTO",
      cell: (row) => {
        const reason = text(row, "ndrReason", "ndr_reason") ?? text(row, "rtoReason", "rto_reason");
        const attempts = Number(row.ndrAttemptCount ?? row.ndr_attempt_count ?? 0);
        if (!reason && attempts < 1) return "—";
        return (
          <div>
            <p>{reason || "Attempt recorded"}</p>
            {attempts > 0 ? <p className="text-xs text-muted">{attempts} attempt{attempts === 1 ? "" : "s"}</p> : null}
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusBadge value={badgeValue(row)} />,
    },
    {
      id: "actions",
      header: "Action",
      cell: (row) => {
        const shipmentId = String(row.id);
        const order = text(row, "orderId", "order_id");
        const article = trackingId(row);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Shipment actions" onClick={(event) => event.stopPropagation()}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onClick={() => router.push(`/dashboard/shipments/${shipmentId}`)}>View</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRoutingId(shipmentId)}>View Timeline</DropdownMenuItem>
              {article ? (
                <DropdownMenuItem onClick={() => window.open(indiaPostPublicTrackingUrl(article), "_blank", "noopener,noreferrer")}>
                  Track
                </DropdownMenuItem>
              ) : null}
              {order ? (
                <DropdownMenuItem onClick={() => router.push(`/dashboard/orders/${order}`)}>View Order</DropdownMenuItem>
              ) : null}
              {article && canSync ? (
                <DropdownMenuItem
                  disabled={sync.isPending}
                  onClick={() => sync.mutate(shipmentId)}
                >
                  Refresh tracking
                </DropdownMenuItem>
              ) : null}
              {isReturn(row) ? (
                <DropdownMenuItem onClick={() => router.push(`/dashboard/shipments/${shipmentId}#rto`)}>
                  View RTO
                </DropdownMenuItem>
              ) : null}
              {isNdrRow(row) ? (
                <DropdownMenuItem onClick={() => router.push(`/dashboard/shipments/${shipmentId}#ndr`)}>
                  View NDR
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="NDR & RTO"
        description="India Post Bulk Tracking for this workspace. Event and last scan come from the CEPT tracking API; the table refreshes stored scans automatically for the visible page."
        actions={
          <div className="flex flex-wrap gap-2">
            {filtersActive ? (
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
            {canSync ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!visibleIds.length) {
                    toast.error("No India Post tracking IDs on this page.");
                    return;
                  }
                  autoSynced.current = visibleIds.join(",");
                  syncVisible.mutate(visibleIds);
                }}
                disabled={syncVisible.isPending || !visibleIds.length}
              >
                <RefreshCw className={cn("size-4", syncVisible.isPending && "animate-spin")} />
                {syncVisible.isPending ? "Syncing India Post…" : "Sync India Post tracking"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void summary.refetch();
                void list.refetch();
              }}
              disabled={list.isFetching || summary.isFetching}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BUCKETS.filter((item) => item.summary).map((item) => {
          const active = bucket === item.id;
          const value = item.summary ? summary.data?.[item.summary] : undefined;
          return (
            <Card
              key={item.id}
              role="button"
              tabIndex={0}
              className={cn("cursor-pointer", active && "ring-2 ring-brand")}
              onClick={() => applyBucket(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  applyBucket(item.id);
                }
              }}
            >
              <CardHeader>
                <CardDescription>{item.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {summary.isLoading ? "…" : summary.isError ? "—" : value ?? 0}
                </CardTitle>
              </CardHeader>
            </Card>
          );
        })}
        <Card>
          <CardHeader>
            <CardDescription>Unclassified tracked</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.isLoading ? "…" : summary.isError ? "—" : summary.data?.unclassifiedTracked ?? 0}
            </CardTitle>
            <CardDescription>
              Barcoded shipments without a stored operational status. Historical events are not classified in the UI.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <div className="flex flex-wrap gap-2">
        {BUCKETS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={bucket === item.id ? "primary" : "secondary"}
            onClick={() => applyBucket(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search order, tracking, customer"
          aria-label="Search"
        />
        <Input value={customer} onChange={(event) => { setCustomer(event.target.value); setPage(1); }} placeholder="Customer" aria-label="Customer" />
        <Input value={orderId} onChange={(event) => { setOrderId(event.target.value); setPage(1); }} placeholder="Order ID" aria-label="Order ID" />
        <Input value={tracking} onChange={(event) => { setTracking(event.target.value); setPage(1); }} placeholder="Tracking ID" aria-label="Tracking ID" />
        <Input value={pincode} onChange={(event) => { setPincode(event.target.value); setPage(1); }} placeholder="Pincode" aria-label="Pincode" />
        <Input value={event} onChange={(event) => { setEvent(event.target.value); setPage(1); }} placeholder="Event" aria-label="Event" />
        <Input type="date" value={from} max={to || format(new Date(), "yyyy-MM-dd")} onChange={(event) => { setFrom(event.target.value); setPage(1); }} aria-label="From date" />
        <Input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1); }} aria-label="To date" />
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SHIPMENT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {item.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows.items}
        loading={list.isLoading}
        error={list.error instanceof Error ? list.error : null}
        emptyTitle="No shipments in this view"
        emptyDescription="Booked India Post shipments appear here. Sync India Post tracking to load CEPT events, last scan office, and NDR/RTO status for the visible page."
        emptyAction={
          <Link href="/dashboard/shipments">
            <Button variant="secondary">
              <PackageX className="size-4" />
              View shipments
            </Button>
          </Link>
        }
        page={page}
        pageSize={rows.pageSize || 20}
        total={rows.total}
        onPageChange={setPage}
        getRowId={(row) => String(row.id)}
        onRowClick={(row) => router.push(`/dashboard/shipments/${row.id}`)}
      />

      <Dialog open={Boolean(routingId)} onOpenChange={(open) => { if (!open) setRoutingId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>India Post routing steps</DialogTitle>
          </DialogHeader>
          {routing.isLoading ? (
            <p className="text-sm text-muted">Loading India Post tracking…</p>
          ) : routing.isError || !routing.data ? (
            <p className="text-sm text-error">
              {routing.error instanceof Error ? routing.error.message : "Could not load routing steps."}
            </p>
          ) : (
            <IndiaPostRouting
              view={buildIndiaPostRoutingView(routing.data, [...(routing.data.events ?? [])])}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
