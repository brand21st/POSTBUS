"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, MoreHorizontal, PackageX, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
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
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { indiaPostPublicTrackingUrl } from "@/modules/india-post/barcode";
import { SHIPMENT_STATUSES, NDR_BUCKETS, type MemberRole, type NdrBucket } from "@/types/domain";
import type { NdrSummary, Paginated, ShipmentRecord } from "@/types/api";
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
      cell: (row) => text(row, "lastEventDescription", "last_event_description") ?? text(row, "lastEventCode", "last_event_code") ?? "—",
    },
    {
      id: "scan",
      header: "Last Scan",
      cell: (row) => {
        const scanEvent = text(row, "lastEventDescription", "last_event_description") ?? text(row, "lastEventCode", "last_event_code");
        const office = text(row, "lastScanOffice", "last_scan_office");
        const when = formatDate(text(row, "lastEventAt", "last_event_at"), true);
        if (!scanEvent && !office && when === "—") return "—";
        return (
          <div>
            <p>{scanEvent || "Scan"}</p>
            <p className="text-xs text-muted">{[office, when].filter((part) => part && part !== "—").join(" · ") || "—"}</p>
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
              <DropdownMenuItem onClick={() => router.push(`/dashboard/shipments/${shipmentId}#tracking-timeline`)}>
                View Timeline
              </DropdownMenuItem>
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
        description="India Post delivery attempts, non-delivery, and return-to-origin scans for this workspace."
        actions={
          <div className="flex flex-wrap gap-2">
            {filtersActive ? (
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Clear filters
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
        emptyDescription="Booked India Post shipments appear here after a tracking scan."
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
    </div>
  );
}
