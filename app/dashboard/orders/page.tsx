"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { asPaginated, customerName, orderNumber } from "@/lib/dashboard/records";
import { formatCurrency, formatDate } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES } from "@/types/domain";
import type { OrderRecord, Paginated } from "@/types/api";

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
  });

  const list = asPaginated<OrderRecord>(query.data, ["orders", "items"]);

  const ship = useMutation({
    mutationFn: (orderIds: string[]) =>
      api("/api/v1/shipments", { method: "POST", body: JSON.stringify({ orderIds }) }),
    onSuccess: () => {
      toast.success("Selected orders were queued for shipping.");
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
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Filter, export, and ship the canonical order list."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={exportCsv}>
              <Download className="size-4" />
              Export
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={selected.length === 0 || ship.isPending}
              onClick={() => ship.mutate(selected)}
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
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle="No orders match these filters"
        emptyDescription="Adjust filters or add a manual order."
        emptyAction={
          <Link href="/dashboard/orders/new" className={buttonVariants()}>
            Add order
          </Link>
        }
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
        selectable
        onSelectionChange={setSelected}
        onRowClick={(row) => router.push(`/dashboard/orders/${row.id}`)}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
