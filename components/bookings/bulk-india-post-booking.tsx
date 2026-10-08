"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/hooks/use-api";
import type { BulkBookingResult } from "@/types/api";

function Counts({ result }: { result: BulkBookingResult | undefined }) {
  if (!result) return null;
  const items = [
    ["Total", result.total],
    ["Valid", result.valid],
    ["Invalid", result.invalid],
    ["Queued", result.queued],
    ["Retrying", result.retrying],
    ["Processing", result.processing],
    ["Booked", result.booked],
    ["Failed", result.failed],
    ["Labels", result.labelsGenerated],
    ["Manifest eligible", result.manifestEligible],
  ] as const;
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border px-2 py-1.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BulkIndiaPostBooking({
  selectedIds,
  onQueued,
  size = "sm",
  iconOnly = false,
}: {
  selectedIds: string[];
  onQueued?: () => void;
  size?: "default" | "sm" | "xs" | "icon-xs";
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BulkBookingResult | null>(null);

  const summary = useQuery({
    queryKey: ["bookings-summary", selectedIds.join(",")],
    enabled: open && selectedIds.length > 0,
    refetchInterval: 4000,
    queryFn: () =>
      api<BulkBookingResult>(`/api/v1/bookings/summary?orderIds=${encodeURIComponent(selectedIds.join(","))}`),
  });

  const validate = useMutation({
    mutationFn: (orderIds: string[]) =>
      api<BulkBookingResult>("/api/v1/bookings/validate", {
        method: "POST",
        body: JSON.stringify({ orderIds }),
      }),
    onSuccess: (data) => setResult(data),
    onError: (error: Error) => toast.error(error.message),
  });

  const queue = useMutation({
    mutationFn: (orderIds: string[]) =>
      api<BulkBookingResult>("/api/v1/bookings/queue", {
        method: "POST",
        body: JSON.stringify({ orderIds }),
      }),
    onSuccess: (data) => {
      setResult(data);
      toast.success(`${data.queued} articles queued for India Post.`);
      onQueued?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const excel = useMutation({
    mutationFn: async ({ file, queueJobs }: { file: File; queueJobs: boolean }) => {
      const body = new FormData();
      body.append("file", file);
      if (queueJobs) body.append("queue", "true");
      return api<BulkBookingResult>("/api/v1/bookings/excel", { method: "POST", body });
    },
    onSuccess: (data, variables) => {
      setResult(data);
      if (variables.queueJobs) toast.success(`${data.queued} Excel articles queued.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const live = summary.data;
  const shown = result
    ? {
        ...result,
        queued: live?.queued ?? result.queued,
        retrying: live?.retrying ?? result.retrying,
        processing: live?.processing ?? result.processing,
        booked: live?.booked ?? result.booked,
        failed: live?.failed ?? result.failed,
        labelsGenerated: live?.labelsGenerated ?? result.labelsGenerated,
        manifestEligible: live?.manifestEligible ?? result.manifestEligible,
      }
    : live;
  const issues = shown?.issues ?? [];

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={iconOnly ? "icon-xs" : size}
        disabled={selectedIds.length === 0}
        title="Bulk book"
        aria-label="Bulk book"
        onClick={() => {
          setOpen(true);
          setResult(null);
          if (selectedIds.length) validate.mutate(selectedIds);
        }}
      >
        <Truck className="size-4" />
        {iconOnly ? null : "Bulk book"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>India Post bulk booking</DialogTitle>
            <DialogDescription>
              Validate Shopify orders before queueing. Invalid rows stay out of the queue. OTP is not used.
            </DialogDescription>
          </DialogHeader>
          <Counts result={shown} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={selectedIds.length === 0 || validate.isPending}
              onClick={() => validate.mutate(selectedIds)}
            >
              {validate.isPending ? "Validating…" : "Validate selected"}
            </Button>
            <Button
              type="button"
              disabled={!result || result.valid === 0 || queue.isPending}
              onClick={() => queue.mutate(selectedIds)}
            >
              {queue.isPending ? "Queueing…" : `Queue ${result?.valid ?? 0} valid`}
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4" />
              Excel
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) excel.mutate({ file, queueJobs: false });
                  event.target.value = "";
                }}
              />
            </label>
            {result && result.valid > 0 && result.rows.some((row) => !row.orderId) ? (
              <Button
                type="button"
                variant="secondary"
                disabled={excel.isPending}
                onClick={() => {
                  toast.message("Re-upload the same workbook and choose Queue Excel.");
                }}
              >
                Queue Excel after a second upload
              </Button>
            ) : null}
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              Queue Excel
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) excel.mutate({ file, queueJobs: true });
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-1.5">Order</th>
                  <th className="px-2 py-1.5">Barcode</th>
                  <th className="px-2 py-1.5">Field</th>
                  <th className="px-2 py-1.5">Value</th>
                  <th className="px-2 py-1.5">Error</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {issues.length ? (
                  issues.map((issue, index) => (
                    <tr key={`${issue.orderId}-${issue.field}-${index}`} className="border-t">
                      <td className="px-2 py-1.5">{issue.orderNumber ?? issue.orderId ?? "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{issue.barcode ?? "—"}</td>
                      <td className="px-2 py-1.5">{issue.field}</td>
                      <td className="px-2 py-1.5">{issue.value || "—"}</td>
                      <td className="px-2 py-1.5">{issue.error}</td>
                      <td className="px-2 py-1.5">{issue.status}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-3 text-muted-foreground" colSpan={6}>
                      {shown?.valid ? "All selected orders passed local validation." : "Run validation to see field errors."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
