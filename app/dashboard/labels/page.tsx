"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Download, FileText, Printer, QrCode, Settings2, Tag } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { ApiError, api } from "@/lib/hooks/use-api";
import { openLabelPdf } from "@/lib/labels/preview";
import { usePrintStation } from "@/lib/hooks/use-print-station";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { FEATURE } from "@/modules/billing/entitlements";
import { shipmentPrintJobs, shipmentPrintLabel, type ShipmentPrintTarget } from "@/modules/labels/print-targets";
import { NOTIFICATIONS_QUERY_KEY } from "@/lib/hooks/use-notifications";
import { LABELS_READY_NOTIFICATION, LABELS_READY_TITLE } from "@/lib/notifications/labels-ready";
import type { LabelRecord, Paginated } from "@/types/api";

function printLabel(status?: string | null) {
  const value = (status ?? "").toUpperCase();
  if (value === "PRINTED") return { text: "Printed", badge: "PRINTED" };
  if (value === "WAITING") return { text: "Waiting to print", badge: "WAITING" };
  if (value === "FAILED") return { text: "Print failed", badge: "FAILED" };
  return null;
}

function barcodeId(row: LabelRecord) {
  return row.indiaPostLabelId ?? row.india_post_label_id ?? ((row.kind ?? "INDIA_POST") !== "MERCHANT" ? row.id : null);
}

function packingId(row: LabelRecord) {
  return row.packingLabelId ?? row.packing_label_id ?? ((row.kind ?? "") === "MERCHANT" ? row.id : null);
}

function documentsStatus(row: LabelRecord) {
  const barcode = barcodeId(row);
  const packing = packingId(row);
  const barcodeState = String(row.barcodeStatus ?? row.barcode_status ?? (barcode ? row.status : "")).toUpperCase();
  const packingState = String(row.packingStatus ?? row.packing_status ?? (packing ? "READY" : "")).toUpperCase();
  if (barcodeState === "FAILED" || packingState === "FAILED") return "FAILED";
  if (barcode && packing && barcodeState === "READY") return "READY";
  if (barcode && barcodeState === "READY") return "INCOMPLETE";
  return "PROCESSING";
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

async function downloadLabelPdf(id: string) {
  const response = await fetch(`/api/v1/labels/${id}/download`, { credentials: "same-origin" });
  if (!response.ok) {
    let message = "Could not download the file.";
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message || message;
    } catch {
      message = "Could not download the file.";
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  const disposition = response.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  link.download = match?.[1] || "label.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export default function LabelsPage() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"ALL" | "COMPLETE" | "INCOMPLETE">("ALL");
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
    onSuccess: () => toast.success("Barcode and packing slip files downloaded."),
    onError: (error: Error) => toast.error(error.message),
  });

  const print = useMutation({
    mutationFn: async (input: { row: LabelRecord; target: ShipmentPrintTarget }) => {
      const jobs = shipmentPrintJobs(input.row, input.target);
      if (!jobs.length) throw new ApiError("Nothing is ready to print yet.", 400);
      if (connected) {
        for (const job of jobs) {
          await api<{ message?: string }>(`/api/v1/labels/${job.id}/print`, {
            method: "POST",
            body: JSON.stringify({ paperSize: job.paperSize }),
          });
        }
        return { connected: true, target: input.target, count: jobs.length };
      }
      for (const job of jobs) {
        window.open(`/api/v1/labels/${job.id}/download`, "_blank", "noopener,noreferrer");
      }
      return { connected: false, target: input.target, count: jobs.length };
    },
    onSuccess: async (result) => {
      if (result.connected) {
        toast.success(
          result.target === "both" && result.count === 2
            ? "Barcode and packing slip sent to the printer."
            : result.target === "packing"
              ? "Packing slip sent to the printer."
              : "Barcode sent to the printer."
        );
      } else {
        toast.success(
          result.count === 2 ? "Opened both PDFs for printing." : "Opened the PDF for printing."
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const downloadBarcode = useMutation({
    mutationFn: downloadLabelPdf,
    onError: (error: Error) => toast.error(error.message),
  });

  const downloadPacking = useMutation({
    mutationFn: async (row: LabelRecord) => {
      const existing = packingId(row);
      if (existing) {
        await downloadLabelPdf(existing);
        return { created: false };
      }
      const created = await api<{ id: string }>(`/api/v1/labels/${barcodeId(row) ?? row.id}/packing-slip`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey: ["labels"] });
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      await downloadLabelPdf(created.id);
      return { created: true };
    },
    onSuccess: (result) => {
      if (!result.created) return;
      window.dispatchEvent(
        new CustomEvent("postbus:new-shopify-orders", {
          detail: [
            {
              id: `labels-ready-${Date.now()}`,
              type: LABELS_READY_NOTIFICATION,
              title: LABELS_READY_TITLE,
              body: "Download the barcode and packing slip.",
              href: "/dashboard/labels",
            },
          ],
        })
      );
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
      header: "Order",
      cell: (row) => (
        <div className="min-w-[7rem]">
          <p className="font-semibold text-foreground">{row.orderNumber ?? row.order_number ?? row.id.slice(0, 8)}</p>
          <p className="text-xs text-muted">{formatDate(row.createdAt ?? row.created_at, true)}</p>
        </div>
      ),
    },
    {
      id: "tracking",
      header: "Tracking",
      cell: (row) => (
        <span className="font-mono text-sm">{row.trackingNumber ?? row.tracking_number ?? row.barcode ?? "—"}</span>
      ),
    },
    {
      id: "documents",
      header: "Documents",
      cell: (row) => {
        const indiaId = barcodeId(row);
        const packId = packingId(row);
        const packingBusy = downloadPacking.isPending && downloadPacking.variables?.id === row.id;
        return (
          <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!indiaId || (downloadBarcode.isPending && downloadBarcode.variables === indiaId)}
              onClick={() => indiaId && downloadBarcode.mutate(indiaId)}
            >
              {indiaId ? <Check className="size-4 text-emerald-600" /> : <QrCode className="size-4" />}
              Barcode
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={packingBusy}
              onClick={() => downloadPacking.mutate(row)}
            >
              {packId ? <Check className="size-4 text-emerald-600" /> : <FileText className="size-4" />}
              {packId ? "Packing slip" : packingBusy ? "Generating…" : "Packing slip"}
            </Button>
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => {
        const status = documentsStatus(row);
        const info = printLabel(row.printStatus ?? row.print_status);
        return (
          <div className="space-y-1">
            <StatusBadge value={status} />
            {info ? <p className="text-xs text-muted">{info.text}</p> : null}
            {row.printError || row.print_error ? (
              <p className="max-w-[16rem] text-xs text-muted">{row.printError ?? row.print_error}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => {
        const indiaId = barcodeId(row);
        const packId = packingId(row);
        const jobs = shipmentPrintJobs(row, "both");
        const busy = print.isPending && print.variables?.row.id === row.id;
        return (
          <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!indiaId || (preview.isPending && preview.variables === indiaId)}
              onClick={() => indiaId && preview.mutate(indiaId)}
            >
              Preview
            </Button>
            <div className="inline-flex">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-r-none"
                disabled={jobs.length === 0 || busy}
                onClick={() => print.mutate({ row, target: jobs.length === 2 ? "both" : jobs[0]?.kind === "packing" ? "packing" : "barcode" })}
              >
                <Printer className="size-4" />
                {shipmentPrintLabel(row)}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="rounded-l-none border-l-0 px-2"
                    disabled={jobs.length === 0 || busy}
                    aria-label="Print options"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!indiaId} onSelect={() => print.mutate({ row, target: "barcode" })}>
                    Print barcode
                    <span className="ml-auto text-xs text-muted">A6</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!packId} onSelect={() => print.mutate({ row, target: "packing" })}>
                    Print packing slip
                    <span className="ml-auto text-xs text-muted">A4</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!indiaId || !packId}
                    onSelect={() => print.mutate({ row, target: "both" })}
                  >
                    Print both
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labels"
        description="One row per shipment. Print both sends the barcode (A6) and packing slip (A4)."
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
            ["ALL", "All shipments"],
            ["COMPLETE", "Both ready"],
            ["INCOMPLETE", "Incomplete"],
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
        emptyDescription="When a shipment is booked, the India Post barcode and packing slip appear on one row."
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
        getRowId={(row) => barcodeId(row) ?? packingId(row) ?? row.id}
      />
    </div>
  );
}
