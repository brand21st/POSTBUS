import type { BadgeProps } from "@/components/ui/badge";
import { QUEUE_SUMMARY_BUCKETS, type BookingQueueState, type QueueSummaryBucket } from "@/modules/booking-queue/state";

/** React Query key for booking-queue/summary, shared by the dashboard and the Orders page button. */
export const QUEUE_SUMMARY_KEY = ["booking-queue-summary"] as const;

/** Merchant-facing names. Shipment statuses keep their own labels elsewhere. */
export const QUEUE_STATE_LABELS: Record<BookingQueueState, string> = {
  PENDING_VALIDATION: "Checking",
  INVALID: "Needs fixing",
  WAITING_APPROVAL: "Waiting for approval",
  READY_FOR_BOOKING: "Ready to book",
  BATCHED: "In a batch",
  SUBMITTING: "Sending to India Post",
  BOOKED: "Booked",
  FAILED: "Failed",
  RECOVERY_REQUIRED: "Needs recovery",
  EXCLUDED: "Excluded",
  CANCELLED: "Cancelled",
};

export function queueStateLabel(state: string | null | undefined) {
  return (state && QUEUE_STATE_LABELS[state as BookingQueueState]) || state || "—";
}

export function queueStateVariant(state: string | null | undefined): NonNullable<BadgeProps["variant"]> {
  switch (state) {
    case "BOOKED":
      return "success";
    case "INVALID":
    case "FAILED":
    case "RECOVERY_REQUIRED":
      return "error";
    case "WAITING_APPROVAL":
    case "PENDING_VALIDATION":
      return "warning";
    case "READY_FOR_BOOKING":
    case "BATCHED":
    case "SUBMITTING":
      return "brand";
    default:
      return "default";
  }
}

export const QUEUE_SOURCE_LABELS: Record<string, string> = {
  SHOPIFY: "Shopify",
  WOOCOMMERCE: "WooCommerce",
  MANUAL: "Manual",
  API: "API",
  WHATSAPP: "WhatsApp",
  EXCEL: "Excel import",
};

export type QueueBucketFilter = QueueSummaryBucket | "all";

export const QUEUE_KPI_CARDS: Array<{
  bucket: QueueBucketFilter;
  label: string;
  className: string;
  iconClass: string;
}> = [
  { bucket: "all", label: "Total in queue", className: "border-border bg-card", iconClass: "bg-surface-soft text-foreground" },
  { bucket: "waitingApproval", label: "Waiting for approval", className: "border-amber-100 bg-amber-50/80", iconClass: "bg-amber-100 text-amber-800" },
  { bucket: "invalid", label: "Needs fixing", className: "border-orange-100 bg-orange-50/80", iconClass: "bg-orange-100 text-orange-800" },
  { bucket: "ready", label: "Ready to book", className: "border-rose-100 bg-rose-50/70", iconClass: "bg-rose-100 text-brand-dark" },
  { bucket: "processing", label: "Processing", className: "border-sky-100 bg-sky-50/80", iconClass: "bg-sky-100 text-sky-800" },
  { bucket: "booked", label: "Booked", className: "border-emerald-100 bg-emerald-50/80", iconClass: "bg-emerald-100 text-emerald-800" },
  { bucket: "failed", label: "Failed", className: "border-red-100 bg-red-50/80", iconClass: "bg-red-100 text-red-700" },
  { bucket: "recovery", label: "Needs recovery", className: "border-red-200 bg-red-50", iconClass: "bg-red-200 text-red-800" },
];

export const QUEUE_TABS = ["queue", "history", "imports"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export type QueueUrlState = {
  tab: QueueTab;
  bucket: QueueBucketFilter;
  source: string;
  q: string;
  page: number;
  importId: string | null;
};

const BUCKETS = new Set<string>(["all", ...Object.keys(QUEUE_SUMMARY_BUCKETS)]);

/** Dashboard state that survives a refresh lives in the URL. */
export function parseQueueUrl(params: URLSearchParams): QueueUrlState {
  const tab = params.get("tab");
  const bucket = params.get("bucket") ?? "all";
  const page = Math.floor(Number(params.get("page")));
  const rawImport = params.get("import");
  const importId = rawImport && /^[0-9a-f-]{36}$/i.test(rawImport) ? rawImport : null;
  return {
    tab: (QUEUE_TABS as readonly string[]).includes(tab ?? "") ? (tab as QueueTab) : importId ? "imports" : "queue",
    bucket: BUCKETS.has(bucket) ? (bucket as QueueBucketFilter) : "all",
    source: params.get("source") || "all",
    q: params.get("q") ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    importId,
  };
}

export function queueUrl(state: Partial<QueueUrlState>) {
  const params = new URLSearchParams();
  if (state.tab && state.tab !== "queue") params.set("tab", state.tab);
  if (state.bucket && state.bucket !== "all") params.set("bucket", state.bucket);
  if (state.source && state.source !== "all") params.set("source", state.source);
  if (state.q?.trim()) params.set("q", state.q.trim());
  if (state.page && state.page > 1) params.set("page", String(state.page));
  if (state.importId) params.set("import", state.importId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Query string for GET booking-queue / booking-queue/history. */
export function queueApiQuery(input: {
  bucket?: QueueBucketFilter;
  source?: string;
  q?: string;
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.bucket && input.bucket !== "all") params.set("state", input.bucket);
  if (input.source && input.source !== "all") params.set("source", input.source);
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  return params.toString();
}

/** Poll fast only while something is moving; never fabricate progress. */
export function queueRefetchInterval(summary: { counts?: { processing?: number }; activeRuns?: number } | undefined) {
  if (!summary) return 30_000;
  return (summary.counts?.processing ?? 0) > 0 || (summary.activeRuns ?? 0) > 0 ? 3_000 : 30_000;
}

export function shortId(id: string | null | undefined) {
  return id ? id.slice(0, 8) : "—";
}

/**
 * One line about the next automatic batch, from persisted values only (no client countdown).
 * Null when booking is manual.
 */
export function nextBatchText(input: {
  mode: "MANUAL" | "AUTOMATIC";
  paused: boolean;
  autoHoldUntil?: string | null;
  batchThreshold: number;
  readyCount: number;
  nextTimeout: string | null;
  formatTime: (iso: string) => string;
}) {
  if (input.mode !== "AUTOMATIC") return null;
  if (input.paused) return "Automatic booking is paused.";
  if (input.autoHoldUntil) return `On hold after repeated failures until ${input.formatTime(input.autoHoldUntil)}.`;
  const threshold = input.batchThreshold.toLocaleString("en-IN");
  if (!input.readyCount) return `Next batch starts when ${threshold} orders are ready.`;
  return input.nextTimeout
    ? `Next batch at ${threshold} ready orders, or by ${input.formatTime(input.nextTimeout)}.`
    : `Next batch at ${threshold} ready orders.`;
}
