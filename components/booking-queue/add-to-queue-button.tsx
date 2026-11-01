"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";
import { toast } from "sonner";
import { QUEUE_SUMMARY_KEY } from "@/components/booking-queue/view";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";
import type { EnqueueResult, QueueSummary } from "@/modules/booking-queue/service";

/** Toast text for an enqueue result. Exported for tests. */
export function enqueueResultMessage(result: EnqueueResult) {
  const added = result.enqueued.length;
  const needsFix = result.enqueued.filter((row) => row.state === "INVALID").length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added to Bulk Booking${needsFix ? ` (${needsFix} need fixing)` : ""}`);
  if (result.skipped.length) {
    const first = result.skipped[0];
    parts.push(
      result.skipped.length === 1
        ? `${first.orderNumber ?? "1 order"} skipped: ${first.reason}`
        : `${result.skipped.length} skipped (${first.reason})`
    );
  }
  return parts.join(". ") || "Nothing was added.";
}

/**
 * Orders page action: add the selected orders to the Bulk Booking queue for approval.
 * Renders nothing unless the workspace is in the Bulk Booking rollout. Never books.
 */
export function AddToQueueButton({
  selectedIds,
  size = "sm",
  onAdded,
}: {
  selectedIds: string[];
  size?: "sm" | "xs";
  onAdded?: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const summary = useQuery({
    queryKey: QUEUE_SUMMARY_KEY,
    queryFn: () => api<QueueSummary>("/api/v1/booking-queue/summary"),
    retry: false,
    staleTime: 60_000,
  });
  const enqueue = useMutation({
    mutationFn: () =>
      api<EnqueueResult>("/api/v1/booking-queue/enqueue", {
        method: "POST",
        body: JSON.stringify({ orderIds: selectedIds, via: "ORDERS_PAGE" }),
      }),
    onSuccess: (result) => {
      const message = enqueueResultMessage(result);
      if (result.enqueued.length) toast.success(message, { action: { label: "Open", onClick: () => router.push("/dashboard/orders/bulk-excel") } });
      else toast.error(message);
      void queryClient.invalidateQueries({ queryKey: QUEUE_SUMMARY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["booking-queue"] });
      onAdded?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!summary.data?.enabled || !selectedIds.length) return null;
  return (
    <Button type="button" variant="secondary" size={size} disabled={enqueue.isPending} onClick={() => enqueue.mutate()}>
      <ListPlus className="size-4" />
      {enqueue.isPending ? "Adding…" : "Add to Bulk Booking"}
    </Button>
  );
}
