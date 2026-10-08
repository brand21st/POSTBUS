"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, LayoutGrid, QrCode, RefreshCw, Tag, Truck } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { ApiError, api } from "@/lib/hooks/use-api";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { FEATURE } from "@/modules/billing/entitlements";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";
import {
  defaultLabelTemplatePage,
  templatePageSizeLabel,
  type LabelTemplate,
} from "@/modules/labels/template-schema";
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

function shipmentIdOf(row: LabelRecord) {
  return row.shipmentId ?? row.shipment_id ?? null;
}

function rowKey(row: LabelRecord) {
  return barcodeId(row) ?? packingId(row) ?? row.id;
}

function canRetryDocuments(status: string) {
  return status === "INCOMPLETE" || status === "FAILED";
}

type RetryIncompleteBatch = {
  retried: number;
  failed: number;
  skipped: number;
  results: Array<{ message?: string; error?: string }>;
};

function toastRetryBatch(data: RetryIncompleteBatch) {
  if (data.retried && data.failed) {
    toast.success(`${data.retried} labels generated. ${data.failed} failed.`);
    return;
  }
  if (data.failed) {
    toast.error(data.results.find((row) => row.error)?.error || "Could not generate the missing label files.");
    return;
  }
  if (data.retried) {
    toast.success(
      data.retried === 1
        ? data.results.find((row) => row.message)?.message || "Missing label files were generated."
        : `${data.retried} labels generated.`
    );
    return;
  }
  toast.success("Those labels are already complete.");
}

async function readPdfResponse(response: Response, fallbackName: string) {
  if (!response.ok) {
    let message = "Could not load the file.";
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message || message;
    } catch {
      message = "Could not load the file.";
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const type = (response.headers.get("Content-Type") ?? blob.type).toLowerCase();
  if (!type.includes("pdf") && !type.includes("octet-stream")) {
    throw new ApiError("The server did not return a PDF.", response.status);
  }
  const disposition = response.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return {
    blob,
    filename: match?.[1] || fallbackName,
    sourceHeader: response.headers.get("X-Label-Source"),
  };
}

async function fetchLabelPdf(id: string, source: "latest" | "shipping-slip") {
  const response = await fetch(`/api/v1/labels/${id}/${source}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/pdf" },
  });
  return readPdfResponse(response, source === "shipping-slip" ? "shipping-slip.pdf" : "india-post-label.pdf");
}

async function fetchOfficialIndiaPostLabelPdf(input: { shipmentId?: string | null; labelId?: string | null }) {
  const shipmentId = input.shipmentId?.trim();
  const labelId = input.labelId?.trim();
  const response = shipmentId
    ? await fetch(`/api/v1/shipments/${shipmentId}/india-post-label`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/pdf" },
      })
    : await fetch(`/api/v1/labels/${labelId}/india-post`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/pdf" },
      });
  return readPdfResponse(response, "india-post-label.pdf");
}

async function previewPdfBlob(blob: Blob, tab: Window | null) {
  const href = URL.createObjectURL(blob);
  if (tab && !tab.closed) {
    tab.location.replace(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

async function previewLabelPdf(
  id: string,
  source: "latest" | "shipping-slip",
  tab: Window | null
) {
  try {
    const { blob, sourceHeader } = await fetchLabelPdf(id, source);
    await previewPdfBlob(blob, tab);
    return sourceHeader;
  } catch (error) {
    tab?.close();
    throw error;
  }
}

async function previewOfficialIndiaPostLabel(
  input: { shipmentId?: string | null; labelId?: string | null },
  tab: Window | null
) {
  try {
    const { blob, sourceHeader } = await fetchOfficialIndiaPostLabelPdf(input);
    await previewPdfBlob(blob, tab);
    return sourceHeader;
  } catch (error) {
    tab?.close();
    throw error;
  }
}

function openPreviewTab() {
  return window.open("about:blank", "_blank");
}

async function downloadPdfBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

async function downloadLabelPdf(id: string, source: "latest" | "shipping-slip") {
  const { blob, filename, sourceHeader } = await fetchLabelPdf(id, source);
  await downloadPdfBlob(blob, filename);
  return sourceHeader;
}

async function downloadOfficialIndiaPostLabel(input: { shipmentId?: string | null; labelId?: string | null }) {
  const { blob, filename, sourceHeader } = await fetchOfficialIndiaPostLabelPdf(input);
  await downloadPdfBlob(blob, filename);
  return sourceHeader;
}

export default function LabelsPage() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"ALL" | "COMPLETE" | "INCOMPLETE">("ALL");
  const [selected, setSelected] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const entitlements = usePlanEntitlements();
  const canBulk = entitlements.allows(FEATURE.bulk);
  const canPacking = entitlements.allows(FEATURE.packing);

  const query = useQuery({
    queryKey: ["labels", page, kind],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (kind !== "ALL") params.set("kind", kind);
      return api<Paginated<LabelRecord>>(`/api/v1/labels?${params.toString()}`);
    },
    refetchInterval: 5_000,
  });

  const templates = useQuery({
    queryKey: ["label-template"],
    queryFn: () => api<{ template: LabelTemplate }>("/api/v1/label-template"),
  });
  const slipSize = templates.data?.template
    ? templatePageSizeLabel(defaultLabelTemplatePage(templates.data.template))
    : null;

  const list = asPaginated<LabelRecord>(query.data, ["labels", "items"]);
  const incompleteIds = list.items
    .filter((row) => documentsStatus(row) === "INCOMPLETE")
    .map(rowKey)
    .filter((id) => (selected.length ? selected.includes(id) : kind === "INCOMPLETE"));

  const bulk = useMutation({
    mutationFn: downloadLabelsZip,
    onSuccess: () => toast.success("Barcode and packing slip files downloaded."),
    onError: (error: Error) => toast.error(error.message),
  });

  const previewLatestLabel = useMutation({
    mutationFn: (input: { shipmentId?: string | null; labelId?: string | null; tab: Window | null }) =>
      previewOfficialIndiaPostLabel({ shipmentId: input.shipmentId, labelId: input.labelId }, input.tab),
    onSuccess: () => {
      toast.success("India Post label generated.");
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewShippingSlip = useMutation({
    mutationFn: (input: { id: string; tab: Window | null }) =>
      previewLabelPdf(input.id, "shipping-slip", input.tab),
    onSuccess: () => toast.success("Shipping slip opened."),
    onError: (error: Error) => toast.error(error.message),
  });

  const downloadLatestLabel = useMutation({
    mutationFn: (input: { shipmentId?: string | null; labelId?: string | null }) =>
      downloadOfficialIndiaPostLabel(input),
    onSuccess: () => {
      toast.success("India Post label downloaded.");
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const downloadShippingSlip = useMutation({
    mutationFn: (id: string) => downloadLabelPdf(id, "shipping-slip"),
    onSuccess: () => toast.success("Shipping slip downloaded."),
    onError: (error: Error) => toast.error(error.message),
  });

  const retryOne = useMutation({
    mutationFn: (id: string) =>
      api<{ message?: string }>(`/api/v1/labels/${id}/retry`, { method: "POST" }),
    onSuccess: (data) => {
      toast.success(data.message || "Missing label files were generated.");
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retryIncomplete = useMutation({
    mutationFn: (ids: string[]) =>
      api<RetryIncompleteBatch>("/api/v1/labels/retry-incomplete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (data) => {
      toastRetryBatch(data);
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
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
        const labelId = indiaId ?? packId;
        const shipmentId = shipmentIdOf(row);
        const canGenerateOfficial = Boolean(shipmentId || labelId);
        const labelPreviewBusy =
          previewLatestLabel.isPending &&
          (previewLatestLabel.variables?.shipmentId ?? previewLatestLabel.variables?.labelId) ===
            (shipmentId || labelId);
        const slipPreviewBusy = previewShippingSlip.isPending && previewShippingSlip.variables?.id === labelId;
        const labelDownloadBusy =
          downloadLatestLabel.isPending &&
          (downloadLatestLabel.variables?.shipmentId ?? downloadLatestLabel.variables?.labelId) ===
            (shipmentId || labelId);
        const slipDownloadBusy = downloadShippingSlip.isPending && downloadShippingSlip.variables === labelId;
        const labelBusy = labelPreviewBusy || labelDownloadBusy;
        const slipBusy = slipPreviewBusy || slipDownloadBusy;
        const indiaReady =
          Boolean(indiaId) &&
          String(row.barcodeStatus ?? row.barcode_status ?? (indiaId ? row.status : "")).toUpperCase() === "READY";
        return (
          <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canGenerateOfficial || labelBusy}
              onClick={() =>
                canGenerateOfficial &&
                previewLatestLabel.mutate({ shipmentId, labelId, tab: openPreviewTab() })
              }
            >
              {indiaId ? <Check className="size-4 text-emerald-600" /> : <QrCode className="size-4" />}
              {labelPreviewBusy ? "Generating…" : "India Post Label"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canGenerateOfficial || labelBusy}
              onClick={() => canGenerateOfficial && downloadLatestLabel.mutate({ shipmentId, labelId })}
            >
              <Download className="size-4" />
              {labelDownloadBusy ? "Generating…" : "Download Label PDF"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!indiaReady || slipBusy}
              onClick={() => labelId && previewShippingSlip.mutate({ id: labelId, tab: openPreviewTab() })}
            >
              <Truck className="size-4" />
              {slipPreviewBusy ? "Opening…" : "Shipping Slip"}
              {slipSize ? (
                <span className="rounded bg-brand px-1 py-px text-[9px] font-bold leading-none text-white">
                  {slipSize}
                </span>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!indiaReady || slipBusy}
              onClick={() => labelId && downloadShippingSlip.mutate(labelId)}
            >
              <Download className="size-4" />
              {slipDownloadBusy ? "Downloading…" : "Download Slip PDF"}
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
        const retryId = rowKey(row);
        const retryBusy = retryOne.isPending && retryOne.variables === retryId;
        return (
          <div className="space-y-1">
            <StatusBadge value={status} />
            {canRetryDocuments(status) ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={retryBusy || retryIncomplete.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  retryOne.mutate(retryId);
                }}
              >
                <RefreshCw className="size-4" />
                {retryBusy ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
            {info ? <p className="text-xs text-muted">{info.text}</p> : null}
            {row.printError || row.print_error ? (
              <p className="max-w-[16rem] text-xs text-muted">{row.printError ?? row.print_error}</p>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labels"
        description="One row per shipment. Preview the India Post barcode and packing slip from the same row."
        actions={
          <>
            <Link href="/dashboard/labels/templates">
              <Button type="button" variant="secondary">
                Shipping templates
              </Button>
            </Link>
            {multiUpPrintEnabled() && canPacking ? (
              <Link href="/dashboard/labels/multi-print">
                <Button type="button" variant="secondary">
                  <LayoutGrid className="size-4" />
                  Multi print
                </Button>
              </Link>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={incompleteIds.length === 0 || retryIncomplete.isPending || retryOne.isPending}
              onClick={() => retryIncomplete.mutate(incompleteIds)}
            >
              <RefreshCw className="size-4" />
              {retryIncomplete.isPending ? "Retrying…" : "Retry incomplete"}
            </Button>
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
        getRowId={rowKey}
      />
    </div>
  );
}
