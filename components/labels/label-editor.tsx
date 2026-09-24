"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { asPaginated } from "@/lib/dashboard/records";
import { fetchLabelPdfBlob } from "@/lib/labels/preview";
import { api } from "@/lib/hooks/use-api";
import { usePrintStation } from "@/lib/hooks/use-print-station";
import { PdfRasterPreview } from "@/components/labels/pdf-raster-preview";
import { pickOfficialPreviewLabel } from "@/modules/labels/preview-pick";
import type { LabelRecord, Paginated } from "@/types/api";

export function LabelEditor() {
  const station = usePrintStation();
  const labelsQuery = useQuery({
    queryKey: ["labels", "official-preview"],
    queryFn: () => api<Paginated<LabelRecord>>("/api/v1/labels?page=1&pageSize=50&kind=INDIA_POST"),
  });
  const officialLabel = pickOfficialPreviewLabel(
    asPaginated<LabelRecord>(labelsQuery.data, ["labels", "items"]).items
  );
  const officialPdfQuery = useQuery({
    queryKey: ["labels", "official-pdf-bytes", officialLabel?.id],
    enabled: Boolean(officialLabel?.id),
    queryFn: async () => {
      const blob = await fetchLabelPdfBlob(officialLabel!.id);
      return blob.arrayBuffer();
    },
  });

  const openOfficial = () => {
    if (!officialLabel?.id) {
      toast.error("Book a shipment to open the India Post label.");
      return;
    }
    window.open(`/api/v1/labels/${officialLabel.id}/download?raw=1`, "_blank", "noopener,noreferrer");
  };

  const printOfficial = async () => {
    const response = await fetch("/api/v1/label-template/print-test", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copies: 1 }),
    });
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/pdf")) {
      const blob = await response.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
      return;
    }
    const payload = (await response.json()) as {
      success?: boolean;
      message?: string;
      data?: { connected?: boolean; downloadPath?: string; message?: string };
    };
    if (!response.ok || payload.success === false) {
      toast.error(payload.message || "Could not print the India Post label.");
      return;
    }
    if (!payload.data?.connected && payload.data?.downloadPath) {
      window.open(payload.data.downloadPath, "_blank", "noopener,noreferrer");
    }
    toast.success(payload.data?.message || payload.message || "India Post label sent to the printer.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="India Post label"
        description="This is the official India Post barcode PDF. Nothing else is added."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={openOfficial} disabled={!officialLabel}>
              Open PDF
            </Button>
            <Button type="button" onClick={() => void printOfficial()} disabled={!officialLabel}>
              Print
            </Button>
          </>
        }
      />

      <section className="rounded-2xl border border-border bg-card p-4">
        {officialPdfQuery.data ? (
          <PdfRasterPreview bytes={officialPdfQuery.data} title="Official India Post label" />
        ) : officialPdfQuery.isError ? (
          <p className="p-6 text-sm text-muted">
            {officialPdfQuery.error instanceof Error
              ? officialPdfQuery.error.message
              : "Could not open the India Post label."}
          </p>
        ) : officialLabel || labelsQuery.isLoading ? (
          <p className="p-6 text-sm text-muted">Loading the official India Post label…</p>
        ) : (
          <p className="p-6 text-sm text-muted">Book a shipment to show the official India Post PDF here.</p>
        )}
        <p className="mt-3 text-center text-xs text-muted">
          {station.data?.connected ? "Printer connected." : "Printer offline — Open PDF to download the official label."}
        </p>
      </section>
    </div>
  );
}
