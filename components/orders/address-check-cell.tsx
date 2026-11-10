"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Package,
  RotateCcw,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ERROR_KIND_LABEL,
  errorActionHint,
  errorQuickAction,
  errorTone,
  finalErrorFromFacts,
  isUnknownBookingError,
  resolveDisplayError,
  AUTO_CORRECT_LABEL,
  addressCorrectionMode,
  type DisplayErrorStatus,
  type ErrorQuickAction,
  type ServerErrorStatus,
} from "@/modules/orders/error-facts";
import { orderNumber } from "@/lib/dashboard/records";
import { cn } from "@/lib/utils";
import type { OrderRecord } from "@/types/api";

export type FinalErrorStatus = ServerErrorStatus;

const ACTION_LABEL: Record<ErrorQuickAction, string> = {
  force: "Force book",
  retry: "Retry booking",
  parcel: "Set parcel",
  review: "Fix address",
  autocorrect: AUTO_CORRECT_LABEL,
  open: "Open order",
};

const ACTION_ICON: Record<ErrorQuickAction, typeof Zap> = {
  force: Zap,
  retry: RotateCcw,
  parcel: Package,
  review: MapPin,
  autocorrect: MapPin,
  open: ExternalLink,
};

export function orderDisplayError(order: OrderRecord, finalStatus?: FinalErrorStatus | null) {
  return resolveDisplayError(order, finalStatus);
}

/** When AI address check is off, drop AI labels, rewrite, and auto-book copy. */
function errorForToggle(error: DisplayErrorStatus | null, aiAddressCheck: boolean): DisplayErrorStatus | null {
  if (!error || aiAddressCheck || error.source !== "ai") return error;
  const rules = finalErrorFromFacts(error.facts);
  return {
    ...error,
    status: rules?.status ?? error.status,
    summary: rules?.summary ?? error.summary,
    source: "rules",
  };
}

function unknownOutcome(order: OrderRecord, error: DisplayErrorStatus) {
  return isUnknownBookingError({ ...order.shipment, summary: error.summary });
}

function StatusPill({
  error,
  label,
  className,
  aiAddressCheck = false,
}: {
  error: DisplayErrorStatus;
  label?: string;
  className?: string;
  aiAddressCheck?: boolean;
}) {
  const tone = errorTone(error.kind);
  const Icon = error.kind === "address" ? MapPin : error.kind === "parcel" ? Package : tone === "failure" ? XCircle : AlertTriangle;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold leading-4",
        tone === "failure"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
        className
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className={label ? "whitespace-normal" : "truncate"}>{label ?? error.status}</span>
      {aiAddressCheck && error.source === "ai" ? (
        <span className="rounded bg-white/70 px-0.5 text-[9px] font-bold uppercase tracking-wide opacity-80 dark:bg-black/30">
          AI
        </span>
      ) : null}
    </span>
  );
}

const LIVE_BOOKING = new Set(["VALIDATING", "QUEUED", "BOOKING"]);
const BOOKING_STUCK_MS = 2 * 60 * 1000;

function bookingAttemptIsLive(order: OrderRecord, busy: boolean) {
  const status = String(order.shipment?.status ?? "").toUpperCase();
  if (!LIVE_BOOKING.has(status)) return false;
  if (busy) return true;
  const stamp = order.shipment?.updated_at ?? order.shipment?.updatedAt;
  if (!stamp) return true;
  const age = Date.now() - Date.parse(stamp);
  return !Number.isFinite(age) || age < BOOKING_STUCK_MS;
}

function stalledBooking(order: OrderRecord): DisplayErrorStatus | null {
  const status = String(order.shipment?.status ?? "").toUpperCase();
  if (!LIVE_BOOKING.has(status)) return null;
  const article = order.shipment?.barcode || order.shipment?.tracking_number || order.shipment?.trackingNumber;
  const message = article
    ? "India Post booking did not finish. The outcome is unknown."
    : "Booking stalled before India Post received it.";
  return {
    status: article ? "RECOVERY_REQUIRED" : "FAILED",
    summary: message,
    source: "rules",
    kind: article ? "provider" : "shipment",
    facts: [{ kind: article ? "provider" : "shipment", message, ...(article ? { code: "CEPT_UNKNOWN" } : {}) }],
  };
}

export function BookingErrorCell({
  order,
  checking = false,
  finalStatus,
  busy = false,
  aiAddressCheck = false,
  onAction,
}: {
  order: OrderRecord;
  checking?: boolean;
  finalStatus?: FinalErrorStatus | null;
  /** The row's quick action is running (e.g. retry in flight). */
  busy?: boolean;
  /** When false, "Fix address and book" becomes a manual address review. */
  aiAddressCheck?: boolean;
  onAction?: (action: ErrorQuickAction | "details") => void;
}) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Checking
      </span>
    );
  }
  if (bookingAttemptIsLive(order, busy)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Booking…
      </span>
    );
  }
  const error = errorForToggle(orderDisplayError(order, finalStatus) ?? stalledBooking(order), aiAddressCheck);
  if (!error) return <span className="text-xs text-muted">—</span>;
  const rawAction = errorQuickAction(error, unknownOutcome(order, error));
  const action = rawAction === "autocorrect" && !aiAddressCheck ? "review" : rawAction;
  const autoLabel =
    action === "autocorrect" && addressCorrectionMode(error) === "auto" ? AUTO_CORRECT_LABEL : undefined;
  const ActionIcon = busy ? Loader2 : ACTION_ICON[action];
  const hint = action === "autocorrect" && aiAddressCheck ? errorActionHint(error, action) : null;
  const exactCode = error.facts.find((fact) => fact.kind === "provider" && fact.code)?.code;

  return (
    <div
      className="flex min-w-0 flex-col items-start gap-1"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex max-w-full items-center gap-1">
        <StatusPill error={error} label={autoLabel} className="min-w-0" aiAddressCheck={aiAddressCheck} />
        {exactCode ? (
          <code className="truncate rounded bg-surface-soft px-1 text-[10px] font-medium text-muted" title="India Post error code">
            {exactCode}
          </code>
        ) : null}
      </div>
      <p className="line-clamp-2 text-[11px] leading-snug text-muted" title={error.summary}>
        {error.summary}
      </p>
      {hint ? <p className="text-[11px] font-medium leading-snug text-emerald-700">{hint}</p> : null}
      {onAction ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant={action === "open" || action === "review" ? "secondary" : "primary"}
            className={cn(
              "h-auto min-h-6 gap-1 whitespace-normal px-2 py-1 text-left text-[11px]",
              action === "force" && "bg-red-600 hover:bg-red-700",
              action === "parcel" && "bg-amber-600 hover:bg-amber-700",
              action === "retry" && "bg-emerald-600 hover:bg-emerald-700"
            )}
            disabled={busy}
            onClick={() => onAction(action)}
          >
            <ActionIcon className={cn("size-3", busy && "animate-spin")} aria-hidden />
            {busy && action === "retry" ? "Booking…" : ACTION_LABEL[action]}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted"
            title="See the exact error"
            onClick={() => onAction("details")}
          >
            <Info className="size-3" aria-hidden />
            Details
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function BookingErrorDialog({
  order,
  finalStatus,
  confirmForce = false,
  forcing = false,
  retrying = false,
  aiAddressCheck = false,
  onOpenChange,
  onAction,
  onForce,
}: {
  order: OrderRecord;
  finalStatus?: FinalErrorStatus | null;
  /** Opened from the Force book button: start on the confirmation step. */
  confirmForce?: boolean;
  forcing?: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: Exclude<ErrorQuickAction, "force" | "open">) => void;
  retrying?: boolean;
  /** When false, "Fix address and book" becomes a manual address review. */
  aiAddressCheck?: boolean;
  onForce: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const error = errorForToggle(orderDisplayError(order, finalStatus), aiAddressCheck);
  const unknown = error ? unknownOutcome(order, error) : false;
  const rawAction = error ? errorQuickAction(error, unknown) : "open";
  const action = rawAction === "autocorrect" && !aiAddressCheck ? "review" : rawAction;
  const barcode = order.shipment?.barcode ?? order.shipment?.trackingNumber ?? order.shipment?.tracking_number;
  const number = orderNumber(order);

  const copy = async () => {
    if (!error) return;
    const lines = error.facts.map(
      (fact) => `[${ERROR_KIND_LABEL[fact.kind]}]${fact.code ? ` ${fact.code}` : ""} ${fact.message}`
    );
    try {
      await navigator.clipboard.writeText([`Order ${number}: ${error.status}`, ...lines].join("\n"));
      toast.success("Error copied.");
    } catch {
      toast.error("Could not copy.");
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Order {number}
            {error ? (
              <StatusPill
                error={error}
                label={action === "autocorrect" && addressCorrectionMode(error) === "auto" ? AUTO_CORRECT_LABEL : undefined}
                aiAddressCheck={aiAddressCheck}
              />
            ) : null}
          </DialogTitle>
          <DialogDescription>{error ? error.summary : "This order has no booking errors now."}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Exact errors</p>
              <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={copy}>
                <Copy className="size-3" aria-hidden />
                Copy
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {error.facts.map((fact, index) => (
                <li key={`${fact.kind}-${index}`} className="flex gap-2 px-3 py-2 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 h-fit shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide",
                      errorTone(fact.kind) === "failure" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                    )}
                  >
                    {ERROR_KIND_LABEL[fact.kind]}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    {fact.code ? <code className="block text-xs font-semibold text-ink">{fact.code}</code> : null}
                    <p className="break-words text-[13px] text-foreground">{fact.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error && unknown ? (
          <div className={cn("space-y-2 rounded-lg border p-3 text-sm", confirmForce ? "border-red-300 bg-red-50/60" : "border-border")}>
            <p className="font-medium text-ink">India Post may have received this article.</p>
            <p className="text-[13px] text-muted">
              Force book first checks India Post tracking{barcode ? ` for ${barcode}` : ""}. If the article is not found
              there, it is submitted again with the same barcode.
            </p>
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-red-600"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I understand this resubmits the article to India Post.
            </label>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Link
            href={`/dashboard/orders/${order.id}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ExternalLink className="size-4" />
            Open order
          </Link>
          <div className="flex flex-wrap gap-2">
            {error?.facts.some((fact) => fact.kind === "parcel") ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => onAction("parcel")}>
                <Package className="size-4" />
                Set parcel
              </Button>
            ) : null}
            {error && action === "autocorrect" ? (
              <Button type="button" variant="secondary" size="sm" className="h-auto whitespace-normal" onClick={() => onAction("autocorrect")}>
                <MapPin className="size-4" />
                {AUTO_CORRECT_LABEL}
              </Button>
            ) : null}
            {error && action === "review" ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => onAction("review")}>
                <MapPin className="size-4" />
                Fix address
              </Button>
            ) : null}
            {error && action === "retry" ? (
              <Button
                type="button"
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={retrying}
                onClick={() => onAction("retry")}
              >
                {retrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                {retrying ? "Booking…" : "Retry booking"}
              </Button>
            ) : null}
            {error && unknown ? (
              <Button
                type="button"
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                disabled={!acknowledged || forcing}
                onClick={onForce}
              >
                {forcing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                {forcing ? "Force booking…" : "Force book"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
