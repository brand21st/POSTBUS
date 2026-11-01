"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QUEUE_SOURCE_LABELS, queueStateLabel, queueStateVariant, shortId } from "@/components/booking-queue/view";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { QueueItemEvent, QueueListItem } from "@/modules/booking-queue/service";
import { indiaPostServiceLabel } from "@/types/domain";

type Detail = { item: QueueListItem; events: QueueItemEvent[] };

export function queueItemQueryKey(itemId: string | null) {
  return ["booking-queue-item", itemId] as const;
}

function issueText(issue: unknown) {
  if (!issue || typeof issue !== "object") return String(issue ?? "");
  const record = issue as { error?: unknown; field?: unknown };
  const error = String(record.error ?? "").trim();
  const field = String(record.field ?? "").trim();
  return error ? (field && !error.toLowerCase().includes(field.replace(/_/g, " ")) ? `${error} (${field})` : error) : field;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}

/** Read-only view of one queue item: who, what, why it is where it is, and its timeline. */
export function BookingDetailDialog({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: queueItemQueryKey(itemId),
    enabled: Boolean(itemId),
    queryFn: () => api<Detail>(`/api/v1/booking-queue/items/${itemId}`),
  });
  const item = detail.data?.item;
  const issues = (item?.issues ?? []).map(issueText).filter(Boolean);

  return (
    <Dialog open={Boolean(itemId)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? `Order ${item.orderNumber ?? shortId(item.orderId)}` : "Booking details"}</DialogTitle>
          <DialogDescription>
            {item ? (
              <Badge variant={queueStateVariant(item.state)}>{queueStateLabel(item.state)}</Badge>
            ) : detail.isError ? (
              (detail.error as Error).message
            ) : (
              "Loading…"
            )}
          </DialogDescription>
        </DialogHeader>
        {item ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Customer" value={item.customerName} />
              <Field label="Phone" value={item.phone} />
              <Field label="PIN" value={item.pincode} />
              <Field label="Source" value={QUEUE_SOURCE_LABELS[item.source] ?? item.source} />
              <Field label="Article type" value={indiaPostServiceLabel(item.serviceCode)} />
              <Field label="Barcode / AWB" value={item.barcode} />
              <Field label="Payment" value={item.paymentStatus} />
              <Field label="Batch" value={item.runId ? shortId(item.runId) : null} />
              <Field label="Booked at" value={item.bookedAt ? formatDate(item.bookedAt, true) : null} />
            </dl>
            {issues.length ? (
              <section>
                <h3 className="text-sm font-semibold text-ink">What needs fixing</h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-700">
                  {issues.map((text, index) => (
                    <li key={`${index}-${text}`}>{text}</li>
                  ))}
                </ul>
              </section>
            ) : item.lastError && item.state !== "BOOKED" ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{item.lastError}</p>
            ) : null}
            <section>
              <h3 className="text-sm font-semibold text-ink">Timeline</h3>
              <ol className="mt-2 space-y-2 border-l border-border pl-4">
                {(detail.data?.events ?? []).map((event) => (
                  <li key={event.id} className="text-sm">
                    <p className="text-ink">
                      {event.fromState ? `${queueStateLabel(event.fromState)} → ` : ""}
                      <span className="font-medium">{queueStateLabel(event.toState)}</span>
                    </p>
                    <p className="text-[11px] text-muted">
                      {formatDate(event.createdAt, true)}
                      {event.actorId ? "" : " · system"}
                      {event.reason ? ` · ${event.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
