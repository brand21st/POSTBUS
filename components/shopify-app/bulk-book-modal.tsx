"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useShopifyApi } from "@/components/shopify-app/api";
import { showToast } from "@/components/shopify-app/app-bridge";
import type { BulkBookingResult } from "@/components/shopify-app/types";
import { ErrorBanner } from "@/components/shopify-app/ui";

type ModalElement = HTMLElementTagNameMap["s-modal"];

const POLL_MS = 3000;
const MAX_POLL_MS = 3 * 60_000;

/** Still waiting on India Post for at least one of the queued orders. */
export function bulkBookingPending(summary: Pick<BulkBookingResult, "queued" | "processing" | "retrying">) {
  return summary.queued + summary.processing + summary.retrying > 0;
}

/** One line per order that can't be booked, grouped so the merchant sees every fix needed. */
export function bulkIssueLines(result: Pick<BulkBookingResult, "issues">) {
  const byOrder = new Map<string, string[]>();
  for (const issue of result.issues) {
    const key = issue.orderNumber || issue.orderId || "Order";
    byOrder.set(key, [...(byOrder.get(key) ?? []), issue.error]);
  }
  return [...byOrder.entries()].map(([order, errors]) => `${order}: ${[...new Set(errors)].join("; ")}`);
}

export function BulkBookModal({
  open,
  orderIds,
  onClose,
  onQueued,
}: {
  open: boolean;
  orderIds: string[];
  onClose: () => void;
  onQueued: () => void;
}) {
  const api = useShopifyApi();
  const modal = useRef<ModalElement>(null);
  const [queuedIds, setQueuedIds] = useState<string[] | null>(null);
  const [pollStarted, setPollStarted] = useState(0);

  // Sync the web component's overlay with the `open` prop (DOM side effect only).
  useEffect(() => {
    if (open) modal.current?.showOverlay();
    else modal.current?.hideOverlay();
  }, [open]);

  function handleHide() {
    setQueuedIds(null);
    onClose();
  }

  const validation = useQuery({
    queryKey: ["bulk-validate", orderIds.join(",")],
    queryFn: () => api<BulkBookingResult>("bookings/validate", { method: "POST", body: { orderIds } }),
    enabled: open && orderIds.length > 0 && !queuedIds,
    staleTime: 0,
  });

  const queue = useMutation({
    mutationFn: () => api<BulkBookingResult>("bookings/queue", { method: "POST", body: { orderIds } }),
    onSuccess: (result) => {
      const ids = result.rows.filter((row) => row.valid && row.orderId).map((row) => row.orderId as string);
      setQueuedIds(ids);
      setPollStarted(Date.now());
      showToast(`${result.queued} ${result.queued === 1 ? "order" : "orders"} sent to India Post`);
      onQueued();
    },
    onError: (error) => showToast(errorMessage(error), { isError: true }),
  });

  const progress = useQuery({
    queryKey: ["bulk-summary", queuedIds?.join(",")],
    queryFn: () => api<BulkBookingResult>(`bookings/summary?orderIds=${encodeURIComponent((queuedIds ?? []).join(","))}`),
    enabled: Boolean(queuedIds?.length),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && !bulkBookingPending(data)) return false;
      return Date.now() - pollStarted < MAX_POLL_MS ? POLL_MS : false;
    },
  });

  const result = validation.data;
  const issues = result ? bulkIssueLines(result) : [];
  const done = progress.data && !bulkBookingPending(progress.data);

  return (
    <s-modal
      ref={modal}
      heading={queuedIds ? "Booking with India Post" : "Book selected orders"}
      size="base"
      onHide={handleHide}
    >
      {queuedIds ? (
        <s-stack gap="base">
          {progress.isError ? <ErrorBanner heading="Couldn't load booking progress" error={progress.error} /> : null}
          <s-paragraph>
            {done
              ? "India Post has answered for every order."
              : "PostBus is booking these orders with India Post. You can close this window; booking continues in the background."}
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
            <ProgressCount label="Booked" value={progress.data?.booked} />
            <ProgressCount
              label="In progress"
              value={progress.data ? progress.data.queued + progress.data.processing + progress.data.retrying : undefined}
            />
            <ProgressCount label="Failed" value={progress.data?.failed} />
          </s-grid>
          {progress.data?.failed ? (
            <s-banner tone="warning">
              Some orders failed to book. Open the order to see India Post&apos;s reason and try again.
            </s-banner>
          ) : null}
        </s-stack>
      ) : validation.isPending ? (
        <s-stack gap="base" alignItems="center">
          <s-spinner accessibilityLabel="Checking orders" />
          <s-text color="subdued">Checking addresses, weights and contracts…</s-text>
        </s-stack>
      ) : validation.isError ? (
        <ErrorBanner heading="Couldn't check these orders" error={validation.error} onRetry={() => validation.refetch()} />
      ) : result ? (
        <s-stack gap="base">
          <s-paragraph>
            <s-text type="strong">{result.valid}</s-text> of {result.total} {result.total === 1 ? "order is" : "orders are"} ready
            to book.
          </s-paragraph>
          {issues.length ? (
            <s-banner tone="warning" heading={`${result.invalid} need fixing first`}>
              <s-unordered-list>
                {issues.slice(0, 10).map((line) => (
                  <s-list-item key={line}>{line}</s-list-item>
                ))}
              </s-unordered-list>
              {issues.length > 10 ? <s-text color="subdued">{`and ${issues.length - 10} more`}</s-text> : null}
            </s-banner>
          ) : null}
        </s-stack>
      ) : null}

      {queuedIds ? (
        <s-button slot="primary-action" variant="primary" onClick={() => modal.current?.hideOverlay()}>
          {done ? "Done" : "Close"}
        </s-button>
      ) : (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={!result || result.valid === 0}
            loading={queue.isPending}
            onClick={() => queue.mutate()}
          >
            {result && result.valid > 0 ? `Book ${result.valid} ${result.valid === 1 ? "order" : "orders"}` : "Book orders"}
          </s-button>
          <s-button slot="secondary-actions" onClick={() => modal.current?.hideOverlay()}>
            Cancel
          </s-button>
        </>
      )}
    </s-modal>
  );
}

function ProgressCount({ label, value }: { label: string; value?: number }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value === undefined ? "–" : String(value)}</s-heading>
      </s-stack>
    </s-box>
  );
}
