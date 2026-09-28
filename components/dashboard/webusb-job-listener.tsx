"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/hooks/use-api";
import { PRINTERS_QUERY_KEY } from "@/components/dashboard/printing-settings";
import { getWebusbProvider } from "@/modules/print/webusb-provider";
import { WEBUSB_DISCONNECTED, WEBUSB_PRINT_FAILED, customerPrintError } from "@/modules/print/webusb-messages";
import type { PrintingConfiguration } from "@/types/api";

type PendingJob = { id: string; copies?: number };
type ClaimedJob = { pdfBase64: string; copies?: number };

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function defaultUsbPrinter(config: PrintingConfiguration | undefined) {
  return (config?.printers ?? []).find((printer) => printer.isDefault ?? printer.is_default) ?? null;
}

export function WebusbJobListener() {
  const queryClient = useQueryClient();
  const provider = getWebusbProvider();
  const printing = useRef(false);
  const blocked = useRef(false);
  const retryAfter = useRef(new Map<string, number>());

  const printersQuery = useQuery({
    queryKey: PRINTERS_QUERY_KEY,
    queryFn: () => api<PrintingConfiguration>("/api/v1/printers"),
    enabled: provider.isAvailable(),
    staleTime: 5_000,
  });
  const printer = defaultUsbPrinter(printersQuery.data);

  const jobsQuery = useQuery({
    queryKey: ["webusb-print-jobs"],
    queryFn: () => api<PendingJob[]>("/api/v1/print-jobs"),
    enabled: provider.isAvailable() && Boolean(printer),
    refetchInterval: printer ? 8_000 : false,
  });

  useEffect(() => {
    if (!provider.isAvailable()) return;
    void provider.syncSaved(printer?.deviceKey ?? null);
  }, [printer?.deviceKey, provider]);

  useEffect(() => {
    const job = jobsQuery.data?.[0];
    if (!job || !printer || blocked.current || printing.current) return;
    if ((retryAfter.current.get(job.id) ?? 0) > Date.now()) return;
    if (provider.getStatus().state !== "connected" || provider.getStatus().deviceKey !== printer.deviceKey) return;

    printing.current = true;
    void printJob(provider, job)
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
          blocked.current = true;
          return;
        }
        retryAfter.current.set(job.id, Date.now() + 15_000);
      })
      .finally(() => {
        printing.current = false;
        void queryClient.invalidateQueries({ queryKey: ["webusb-print-jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["labels"] });
      });
  }, [jobsQuery.data, printer, provider, queryClient]);

  return null;
}

async function printJob(provider: ReturnType<typeof getWebusbProvider>, job: PendingJob) {
  let claimed = false;
  try {
    const result = await api<ClaimedJob>(`/api/v1/print-jobs/${job.id}/claim`, { method: "POST" });
    claimed = true;
    if (!result.pdfBase64) throw new Error(WEBUSB_PRINT_FAILED);
    await provider.printLabel(bytesFromBase64(result.pdfBase64), result.copies || job.copies || 1);
    await api(`/api/v1/print-jobs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "PRINTED" }),
    });
  } catch (error) {
    if (!claimed) throw error;
    const message = customerPrintError(error);
    const retry = message === WEBUSB_DISCONNECTED || message === WEBUSB_PRINT_FAILED;
    await api(`/api/v1/print-jobs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        status: retry ? "PENDING" : "FAILED",
        errorMessage: message,
      }),
    }).catch(() => undefined);
    toast.error(message);
    throw new Error(message);
  }
}
