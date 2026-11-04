"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
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
import { api, isUnknownBookingConflict, toSearchParams } from "@/lib/hooks/use-api";
import { indiaPostVisibleShipmentError, isIndiaPostBookingInFlight } from "@/modules/india-post/booking-status";
import { bookingQueueLabel } from "@/modules/india-post/booking-retry-eligibility";
import { INDIA_POST_SERVICES, indiaPostServiceLabel, SHIPMENT_STATUSES } from "@/types/domain";
import type { Paginated, ShipmentRecord } from "@/types/api";

export default function ShipmentsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ["shipments", page, debounced, status, service],
    queryFn: () =>
      api<Paginated<ShipmentRecord>>(
        `/api/v1/shipments?${toSearchParams({
          page,
          pageSize: 20,
          q: debounced,
          status: status === "all" ? undefined : status,
          serviceCode: service === "all" ? undefined : service,
        })}`
      ),
    refetchInterval: (current) => {
      const rows = asPaginated<ShipmentRecord>(current.state.data, ["shipments", "items"]).items;
      return rows.some((row) => isIndiaPostBookingInFlight(row.status)) ? 3_000 : false;
    },
  });

  const list = asPaginated<ShipmentRecord>(query.data, ["shipments", "items"]);
  const bulkRetry = useMutation({
    mutationFn: () =>
      api<{
        eligible: number;
        scheduled: number;
        alreadyProcessing: number;
        needsReview: number;
        failedValidation: number;
      }>("/api/v1/shipments/retry-booking", {
        method: "POST",
        body: JSON.stringify({ shipmentIds: selectedIds }),
      }),
    onSuccess: (result) => {
      toast.success(
        `Eligible ${result.eligible}. Scheduled ${result.scheduled}. Already processing ${result.alreadyProcessing}. Needs review ${result.needsReview}. Failed validation ${result.failedValidation}.`
      );
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: DataTableColumn<ShipmentRecord>[] = [
    {
      id: "tracking",
      header: "Tracking",
      cell: (row) => (
        <Link href={`/dashboard/shipments/${row.id}`} className="font-medium hover:text-brand">
          {row.trackingNumber ?? row.tracking_number ?? row.barcode ?? row.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      id: "order",
      header: "Order",
      cell: (row) => row.orderNumber ?? row.order_number ?? "—",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <span title={row.status ?? ""}>
          <StatusBadge value={bookingQueueLabel(row)} />
        </span>
      ),
    },
    {
      id: "retry",
      header: "",
      hug: true,
      cell: (row) => {
        const label = bookingQueueLabel(row);
        if (label !== "Queued" && label !== "Stuck" && label !== "Failed") return null;
        return (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async (event) => {
              event.stopPropagation();
              try {
                const result = await api<{ message?: string }>(`/api/v1/shipments/${row.id}/retry`, { method: "POST" });
                toast.success(result.message || "Retry scheduled.");
                queryClient.invalidateQueries({ queryKey: ["shipments"] });
              } catch (error) {
                if (isUnknownBookingConflict(error)) {
                  try {
                    const forced = await api<{ message?: string }>(`/api/v1/shipments/${row.id}/force-book`, {
                      method: "POST",
                      body: JSON.stringify({ confirm: true }),
                    });
                    toast.success(forced.message || "Force book scheduled with the same barcode.");
                    queryClient.invalidateQueries({ queryKey: ["shipments"] });
                    return;
                  } catch (forceError) {
                    toast.error(forceError instanceof Error ? forceError.message : "Force book could not be started.");
                    return;
                  }
                }
                toast.error(error instanceof Error ? error.message : "Shipment could not be retried.");
              }
            }}
          >
            Retry
          </Button>
        );
      },
    },
    {
      id: "service",
      header: "Service",
      cell: (row) => indiaPostServiceLabel(row.serviceCode ?? row.service_code),
    },
    {
      id: "error",
      header: "Last error",
      cell: (row) => {
        const message = indiaPostVisibleShipmentError(row);
        if (!message) return "—";
        return (
          <span className="block max-w-md whitespace-pre-wrap break-words text-error" title={message}>
            {message}
          </span>
        );
      },
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => formatDate(row.createdAt ?? row.created_at, true),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipments"
        description="Booking status, barcodes, and provider errors from real shipment jobs."
        actions={
          selectedIds.length ? (
            <Button
              type="button"
              variant="secondary"
              disabled={bulkRetry.isPending}
              onClick={() => bulkRetry.mutate()}
            >
              {bulkRetry.isPending ? "Checking…" : `Retry selected (${selectedIds.length})`}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tracking, barcode, order…"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SHIPMENT_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={service}
          onValueChange={(value) => {
            setService(value);
            setPage(1);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Service" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {INDIA_POST_SERVICES.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle="No shipments yet"
        emptyDescription="Ship an order to queue a booking job. India Post must be connected before booking can succeed."
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
        onRowClick={(row) => router.push(`/dashboard/shipments/${row.id}`)}
        getRowId={(row) => row.id}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
    </div>
  );
}
