"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/hooks/use-api";

export type BookedExportFilters = { q?: string; source?: string; from?: string; to?: string };
type Plan = { total: number; limit: number; parts: Array<{ part: number; from: number; to: number; count: number; filename: string }> };

/** Request body for the export endpoints from the History filters. Exported for tests. */
export function exportRequestBody(filters: BookedExportFilters, part?: number) {
  const body: Record<string, unknown> = {};
  if (filters.q?.trim()) body.q = filters.q.trim();
  if (filters.source && filters.source !== "all") body.source = filters.source;
  if (filters.from) body.from = filters.from;
  if (filters.to) body.to = filters.to;
  if (part) body.part = part;
  return body;
}

async function download(filters: BookedExportFilters, part: Plan["parts"][number]) {
  const response = await fetch("/api/v1/booking-queue/export", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exportRequestBody(filters, part.part)),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    toast.error(failure?.message || "Could not export the India Post Excel.");
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = part.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Booked shipments in the India Post bulk upload workbook (ArticleDetails + Information), exactly
 * as India Post's template, split into files by the workspace's rows-per-file limit.
 */
export function ExportBookedButton({ filters }: { filters: BookedExportFilters }) {
  const [open, setOpen] = useState(false);
  const plan = useMutation({
    mutationFn: () =>
      api<Plan>("/api/v1/booking-queue/export/plan", { method: "POST", body: JSON.stringify(exportRequestBody(filters)) }),
    onSuccess: () => setOpen(true),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <>
      <Button type="button" size="sm" variant="secondary" disabled={plan.isPending} onClick={() => plan.mutate()}>
        <FileSpreadsheet className="size-4" />
        {plan.isPending ? "Preparing…" : "Export India Post Excel"}
      </Button>
      <Dialog open={open && Boolean(plan.data)} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export booked shipments</DialogTitle>
            <DialogDescription>
              {plan.data
                ? `${plan.data.total.toLocaleString("en-IN")} booked shipment${plan.data.total === 1 ? "" : "s"} matching your filters, in the India Post bulk upload format. Up to ${plan.data.limit.toLocaleString("en-IN")} rows per file.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(plan.data?.parts ?? []).map((part) => (
              <li key={part.part}>
                <Button type="button" className="w-full justify-start" variant="secondary" onClick={() => void download(filters, part)}>
                  <Download className="size-4" />
                  <span className="truncate">{part.filename}</span>
                  <span className="ml-auto text-xs text-muted">rows {part.from}–{part.to}</span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Only shipments India Post has confirmed are included, so every barcode is a booked article.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
