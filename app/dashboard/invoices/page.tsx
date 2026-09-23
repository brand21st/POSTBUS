"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { asPaginated, customerName } from "@/lib/dashboard/records";
import { formatCurrency, formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { InvoiceRecord, Paginated } from "@/types/api";

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const [regenerate, setRegenerate] = useState<InvoiceRecord | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["invoices", page],
    queryFn: () => api<Paginated<InvoiceRecord>>(`/api/v1/invoices?page=${page}&pageSize=20`),
    refetchInterval: 5_000,
  });
  const list = asPaginated<InvoiceRecord>(query.data);

  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/v1/invoices/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Invoice retry queued.");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const regenerateMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/invoices/${id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      }),
    onSuccess: () => {
      toast.success("Invoice regenerated.");
      setRegenerate(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: DataTableColumn<InvoiceRecord>[] = [
    {
      id: "invoice",
      header: "Invoice",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium tabular-nums leading-tight">
            {row.invoiceNumber ?? row.invoice_number ?? row.id.slice(0, 8)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge value={row.status} />
            <span className="text-xs text-muted">{formatDate(row.createdAt ?? row.created_at)}</span>
          </div>
        </div>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="min-w-0 max-w-[14rem]">
          <p className="truncate font-medium leading-tight">{customerName(row)}</p>
          <p className="mt-0.5 text-xs text-muted">{row.orderNumber ?? row.order_number ?? "—"}</p>
        </div>
      ),
    },
    {
      id: "tracking",
      header: "Tracking",
      cell: (row) => (
        <span className="font-mono text-xs tracking-tight">
          {row.trackingNumber ?? row.tracking_number ?? "—"}
        </span>
      ),
    },
    {
      id: "total",
      header: "Total",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {formatCurrency(row.totalAmount ?? row.total_amount, row.currency)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <InvoiceActions
          compact
          invoice={row}
          retrying={retry.isPending}
          onRetry={() => retry.mutate(row.id)}
          onRegenerate={() => setRegenerate(row)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="Created automatically after India Post returns a tracking ID."
        actions={
          <Link href="/dashboard/invoices/customize">
            <Button type="button" variant="secondary" size="sm">
              <Settings2 className="size-4" />
              Customize
            </Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        data={list.items}
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle="No invoices yet"
        emptyDescription="Book a shipment. When India Post returns a tracking ID, PostBus generates the invoice."
        emptyAction={
          <div className="flex items-center gap-2 text-muted">
            <Receipt className="size-4" />
            Book from Orders to create invoices.
          </div>
        }
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
      />
      <Dialog open={Boolean(regenerate)} onOpenChange={(open) => !open && setRegenerate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate invoice?</DialogTitle>
            <DialogDescription>
              The invoice number stays the same. The PDF is replaced using your current invoice design.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRegenerate(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={regenerateMutation.isPending}
              onClick={() => regenerate && regenerateMutation.mutate(regenerate.id)}
            >
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
