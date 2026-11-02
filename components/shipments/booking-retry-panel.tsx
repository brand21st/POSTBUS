"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";
import type { BookingRetryAction } from "@/modules/india-post/booking-retry-eligibility";

type Decision = {
  eligible: boolean;
  action: BookingRetryAction;
  reason: string;
  requiresManualReview: boolean;
  nextAttemptAt?: string | null;
};

export function BookingRetryPanel({ shipmentId, canRetry }: { shipmentId: string; canRetry: boolean }) {
  const queryClient = useQueryClient();
  const decision = useQuery({
    queryKey: ["booking-retry", shipmentId],
    queryFn: () => api<Decision>(`/api/v1/shipments/${shipmentId}/booking-retry`),
    enabled: canRetry && Boolean(shipmentId),
  });

  const retry = useMutation({
    mutationFn: () =>
      api<{ message?: string; scheduled?: boolean }>(`/api/v1/shipments/${shipmentId}/retry`, { method: "POST" }),
    onSuccess: (result) => {
      toast.success(result.message || "Retry scheduled.");
      queryClient.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      queryClient.invalidateQueries({ queryKey: ["booking-retry", shipmentId] });
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api<{ message?: string; reconciled?: boolean }>(`/api/v1/shipments/${shipmentId}/reconcile-booking`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      toast.message(result.message || "Booking check finished.");
      queryClient.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      queryClient.invalidateQueries({ queryKey: ["booking-retry", shipmentId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const forceBook = useMutation({
    mutationFn: () =>
      api<{ message?: string; scheduled?: boolean; reconciled?: boolean }>(
        `/api/v1/shipments/${shipmentId}/force-book`,
        {
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        }
      ),
    onSuccess: (result) => {
      toast.success(result.message || "Force book scheduled.");
      queryClient.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      queryClient.invalidateQueries({ queryKey: ["booking-retry", shipmentId] });
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!canRetry || !decision.data) return null;
  const current = decision.data;
  if (current.action === "ALREADY_BOOKED") return null;

  return (
    <div className="flex flex-col items-start gap-2">
      {current.action === "SAFE_TO_REQUEUE" ? (
        <Button type="button" variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
          <RotateCcw className="size-4" />
          {retry.isPending ? "Scheduling…" : "Retry Booking"}
        </Button>
      ) : (
        <p className="max-w-sm text-sm text-muted">{current.reason}</p>
      )}
      {current.requiresManualReview ? (
        <>
          <Button type="button" variant="secondary" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
            {reconcile.isPending ? "Checking…" : "Check India Post tracking"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => forceBook.mutate()}
            disabled={forceBook.isPending}
          >
            {forceBook.isPending ? "Force booking…" : "Force book article"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
