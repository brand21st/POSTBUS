"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCheck, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { QUEUE_SUMMARY_KEY } from "@/components/booking-queue/view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/hooks/use-api";
import type { DispatchResult, QueueActionResult } from "@/modules/booking-queue/actions";

/** Above this many orders the person types BOOK to confirm. */
export const TYPED_CONFIRM_THRESHOLD = 500;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Toast text for approve / exclude / check-again results. Exported for tests. */
export function queueActionMessage(verb: string, result: QueueActionResult) {
  const parts = [`${plural(result.applied.length, "order")} ${verb}`];
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped: ${result.skipped[0].reason}`);
  return parts.join(". ");
}

/** Toast text after booking. Exported for tests. */
export function dispatchMessage(result: DispatchResult) {
  if (!result.runId) {
    return result.skipped.length
      ? `Nothing was booked. ${plural(result.skipped.length, "order")} ${result.skipped.length === 1 ? "is" : "are"} not ready to book.`
      : "Nothing was booked.";
  }
  const parts = [
    result.replayed
      ? `This booking was already started (batch ${result.runId.slice(0, 8)}).`
      : `Booking started for ${plural(result.dispatched.length, "order")} (batch ${result.runId.slice(0, 8)}).`,
  ];
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped because they were not ready to book.`);
  return parts.join(" ");
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function useInvalidateQueue() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: QUEUE_SUMMARY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["booking-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["booking-queue-item"] });
  };
}

/** Confirmation for booking. The key is made when the dialog opens: a double click books once. */
function ConfirmBookingDialog({
  itemIds,
  onClose,
  onBooked,
}: {
  itemIds: string[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const invalidate = useInvalidateQueue();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [typed, setTyped] = useState("");
  const needsTyping = itemIds.length > TYPED_CONFIRM_THRESHOLD;
  const book = useMutation({
    mutationFn: () =>
      api<DispatchResult>("/api/v1/booking-queue/dispatch", {
        method: "POST",
        body: JSON.stringify({ itemIds, idempotencyKey }),
      }),
    onSuccess: (result) => {
      if (result.runId) toast.success(dispatchMessage(result));
      else toast.error(dispatchMessage(result));
      invalidate();
      onBooked();
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const ready = !needsTyping || typed.trim().toUpperCase() === "BOOK";

  return (
    <Dialog open onOpenChange={(open) => (open || book.isPending ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Book {plural(itemIds.length, "selected order")} with India Post?</DialogTitle>
          <DialogDescription>
            This creates real India Post bookings on your connected account and uses barcodes from your range and your plan&apos;s
            shipment quota. Only orders that are Ready to book are sent; any others are skipped and listed afterwards.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted">
          Articles are sent one per request. Results appear in the queue as India Post answers; you can close this page.
        </p>
        {needsTyping ? (
          <label className="block text-sm">
            Type <span className="font-semibold">BOOK</span> to confirm {plural(itemIds.length, "order")}
            <Input className="mt-1" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={book.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!ready || book.isPending} onClick={() => book.mutate()}>
            <Send className="size-4" />
            {book.isPending ? "Starting…" : "Book with India Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useQueueAction(
  path: "approve" | "exclude" | "revalidate",
  verb: string,
  selectedIds: string[],
  onDone: () => void
) {
  const invalidate = useInvalidateQueue();
  return useMutation({
    mutationFn: () =>
      api<QueueActionResult>(`/api/v1/booking-queue/${path}`, {
        method: "POST",
        body: JSON.stringify({ itemIds: selectedIds }),
      }),
    onSuccess: (result) => {
      if (result.applied.length) toast.success(queueActionMessage(verb, result));
      else toast.error(queueActionMessage(verb, result));
      invalidate();
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/** Selection actions for the queue table. Approval never books; booking needs its own confirmation. */
export function QueueBulkActions({ selectedIds, onDone }: { selectedIds: string[]; onDone: () => void }) {
  const [confirmBooking, setConfirmBooking] = useState(false);
  const approve = useQueueAction("approve", "approved", selectedIds, onDone);
  const exclude = useQueueAction("exclude", "excluded", selectedIds, onDone);
  const revalidate = useQueueAction("revalidate", "checked again", selectedIds, onDone);
  const busy = approve.isPending || exclude.isPending || revalidate.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => approve.mutate()}>
        <CheckCheck className="size-4" />
        Approve
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => revalidate.mutate()}>
        <RefreshCw className="size-4" />
        Check again
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => exclude.mutate()}>
        <Ban className="size-4" />
        Exclude
      </Button>
      <Button type="button" size="sm" disabled={busy} onClick={() => setConfirmBooking(true)}>
        <Send className="size-4" />
        Bulk Booking
      </Button>
      {confirmBooking ? (
        <ConfirmBookingDialog itemIds={selectedIds} onClose={() => setConfirmBooking(false)} onBooked={onDone} />
      ) : null}
    </div>
  );
}

/** "Approve all waiting" with the count the person saw; the server refuses if it changed. */
export function ApproveAllWaiting({ waiting }: { waiting: number }) {
  const invalidate = useInvalidateQueue();
  const [open, setOpen] = useState(false);
  const approveAll = useMutation({
    mutationFn: () =>
      api<QueueActionResult>("/api/v1/booking-queue/approve", {
        method: "POST",
        body: JSON.stringify({ all: true, expectedCount: waiting }),
      }),
    onSuccess: (result) => {
      toast.success(queueActionMessage("approved", result));
      invalidate();
      setOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      invalidate();
      setOpen(false);
    },
  });
  if (!waiting) return null;
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CheckCheck className="size-4" />
        Approve all waiting ({waiting.toLocaleString("en-IN")})
      </Button>
      <Dialog open={open} onOpenChange={(next) => (approveAll.isPending ? undefined : setOpen(next))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {plural(waiting, "order")}?</DialogTitle>
            <DialogDescription>
              They move to Ready to book. Nothing is sent to India Post until you choose Bulk Booking.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={approveAll.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={approveAll.isPending} onClick={() => approveAll.mutate()}>
              {approveAll.isPending ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
