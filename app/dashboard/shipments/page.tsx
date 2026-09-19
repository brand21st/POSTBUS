"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { SHIPMENT_STATUSES } from "@/types/domain";
import type { Paginated, ShipmentRecord } from "@/types/api";

export default function ShipmentsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ["shipments", page, debounced, status],
    queryFn: () =>
      api<Paginated<ShipmentRecord>>(
        `/api/v1/shipments?${toSearchParams({
          page,
          pageSize: 20,
          q: debounced,
          status: status === "all" ? undefined : status,
        })}`
      ),
  });

  const list = asPaginated<ShipmentRecord>(query.data, ["shipments", "items"]);

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
    { id: "status", header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
    {
      id: "service",
      header: "Service",
      cell: (row) => row.serviceCode ?? row.service_code ?? "—",
    },
    {
      id: "error",
      header: "Last error",
      cell: (row) => row.lastError ?? row.last_error ?? "—",
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
      />
    </div>
  );
}
