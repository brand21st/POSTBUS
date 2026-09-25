"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Printer, Settings2, Tag } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { ApiError, api } from "@/lib/hooks/use-api";
import { openLabelPdf } from "@/lib/labels/preview";
import { usePrintStation } from "@/lib/hooks/use-print-station";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { FEATURE } from "@/modules/billing/entitlements";
import type { LabelRecord, Paginated } from "@/types/api";

function printLabel(status?: string | null) {
  const value = (status ?? "").toUpperCase();
  if (value === "PRINTED") return { text: "Printed", badge: "PRINTED" };
  if (value === "WAITING") return { text: "Waiting to print", badge: "WAITING" };
  if (value === "FAILED") return { text: "Print failed", badge: "FAILED" };
  return null;
}

async function downloadLabelsZip(ids: string[]) {
  const response = await fetch("/api/v1/labels/bulk-download", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/zip")) {
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "labels.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    return;
  }
  let message = "Could not download labels.";
  try {
    const payload = (await response.json()) as { message?: string };
    message = payload.message || message;
  } catch {
    message = response.ok ? message : "The server returned an unexpected response.";
  }
  throw new ApiError(message, response.status);
}

export default function LabelsPage() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"ALL" | "INDIA_POST" | "MERCHANT">("ALL");
  const [selected, setSelected] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const station = usePrintStation();
  const entitlements = usePlanEntitlements();
  const canBulk = entitlements.allows(FEATURE.bulk);
  const canPacking = entitlements.allows(FEATURE.packing);
  const connected = Boolean(station.data?.connected);

  const query = useQuery({
    queryKey: ["labels", page, kind],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (kind !== "ALL") params.set("kind", kind);
      return api<Paginated<LabelRecord>>(`/api/v1/labels?${params.toString()}`);
    },
    refetchInterval: 5_000,
  });

  const list = asPaginated<LabelRecord>(query.data, ["labels", "items"]);

  const bulk = useMutation({
    mutationFn: downloadLabelsZip,
    onSuccess: () => toast.success("Labels downloaded."),
    onError: (error: Error) => toast.error(error.message),
  });

  const print = useMutation({
    mutationFn: (id: string) =>
      api<{ message?: string }>(`/api/v1/labels/${id}/print`, { method: "POST" }),
    onSuccess: async (data) => {
      toast.success(data.message || "The label was sent to the printer.");
      await queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const downloadPacking = useMutation({
    mutationFn: async (row: LabelRecord) => {
      const packingId = row.packingLabelId ?? row.packing_label_id;
      if (packingId) {
        window.location.href = `/api/v1/labels/${packingId}/download`;
        return packingId;
      }
      const created = await api<{ id: string }>(`/api/v1/labels/${row.id}/packing-slip`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["labels"] });
      window.location.href = `/api/v1/labels/${created.id}/download`;
      return created.id;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const preview = useMutation({
    mutationFn: (id: string) => openLabelPdf(id),
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: DataTableColumn<LabelRecord>[] = [
    {
      id: "label",
      header: "Label",
      cell: (row) => row.orderNumber ?? row.order_number ?? row.id.slice(0, 8),
    },
    {
      id: "tracking",
      header: "Tracking",
      cell: (row) => row.trackingNumber ?? row.tracking_number ?? row.barcode ?? "—",
    },
    {
      id: "kind",
      header: "Type",
      cell: (row) => ((row.kind ?? "INDIA_POST") === "MERCHANT" ? "Packing" : "India Post"),
    },
    { id: "status", header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
    {
      id: "print",
      header: "Print",
      cell: (row) => {
        const info = printLabel(row.printStatus ?? row.print_status);
        if (!info) return <span className="text-muted">—</span>;
        return (
          <div className="space-y-0.5">
            <StatusBadge value={info.badge} />
            {row.printError || row.print_error ? (
              <p className="max-w-[16rem] text-xs text-muted">{row.printError ?? row.print_error}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => formatDate(row.createdAt ?? row.created_at, true),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => {
        const indiaId = row.indiaPostLabelId ?? row.india_post_label_id ?? ((row.kind ?? "INDIA_POST") !== "MERCHANT" ? row.id : null);
        const packingId = row.packingLabelId ?? row.packing_label_id ?? ((row.kind ?? "") === "MERCHANT" ? row.id : null);
        const indiaHref = indiaId ? `/api/v1/labels/${indiaId}/download` : null;
        const indiaReady = Boolean(indiaId);
        return (
          <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!indiaReady || (preview.isPending && preview.variables === indiaId)}
              onClick={() => indiaId && preview.mutate(indiaId)}
            >
              Preview
            </Button>
            <a href={indiaHref ?? undefined} className={!indiaHref ? "pointer-events-none opacity-50" : undefined}>
              <Button type="button" variant="secondary" size="sm" disabled={!indiaHref}>
                <Download className="size-4" />
                Barcode
              </Button>
            </a>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={downloadPacking.isPending}
              onClick={() => downloadPacking.mutate(row)}
            >
              <Download className="size-4" />
              {packingId ? "Packing slip" : "Create packing slip"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!indiaReady || print.isPending}
              onClick={() => {
                if (!indiaId) return;
                if (connected) {
                  print.mutate(indiaId);
                  return;
                }
                if (indiaHref) window.open(indiaHref, "_blank", "noopener,noreferrer");
              }}
            >
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labels"
        description="Download the India Post barcode label and the packing slip for each shipment."
        actions={
          <>
            <Link href="/dashboard/labels/customize">
              <Button type="button" variant="secondary">
                <Settings2 className="size-4" />
                {canPacking ? "Customize Label" : "Upgrade plan"}
              </Button>
            </Link>
            <Button
              type="button"
              variant="secondary"
              disabled={canBulk ? selected.length === 0 || bulk.isPending : false}
              onClick={() => {
                if (!canBulk) {
                  window.location.href = "/dashboard/billing";
                  return;
                }
                bulk.mutate(selected);
              }}
            >
              <Download className="size-4" />
              {canBulk ? "Bulk download" : "Upgrade plan"}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["ALL", "All"],
            ["INDIA_POST", "India Post"],
            ["MERCHANT", "Packing"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={kind === value ? "primary" : "secondary"}
            onClick={() => {
              setKind(value);
              setPage(1);
              setSelected([]);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={list.items}
        loading={query.isLoading}
        error={query.error instanceof Error ? query.error : null}
        emptyTitle="No labels yet"
        emptyDescription="Labels appear here after a shipment is booked and the label job succeeds."
        emptyAction={
          <div className="flex items-center gap-2 text-muted">
            <Tag className="size-4" />
            Connect India Post to generate labels.
          </div>
        }
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
        onPageChange={setPage}
        selectable
        onSelectionChange={setSelected}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
