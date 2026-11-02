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
import { isIndiaPostBookingInFlight } from "@/modules/india-post/booking-status";
import {
  ERROR_KIND_LABEL,
  errorActionHint,
  errorQuickAction,
  errorTone,
  isUnknownBookingError,
  resolveDisplayError,
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
  open: "Open order",
};

const ACTION_ICON: Record<ErrorQuickAction, typeof Zap> = {
  force: Zap,
  retry: RotateCcw,
  parcel: Package,
  review: MapPin,
  open: ExternalLink,
};

export function orderDisplayError(order: OrderRecord, finalStatus?: FinalErrorStatus | null) {
  return resolveDisplayError(order, finalStatus);
}

function unknownOutcome(order: OrderRecord, error: DisplayErrorStatus) {
  return isUnknownBookingError({ ...order.shipment, summary: error.summary });
}

function StatusPill({ error, className }: { error: DisplayErrorStatus; className?: string }) {
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
      <span className="truncate">{error.status}</span>
      {error.source === "ai" ? (
        <span className="rounded bg-white/70 px-0.5 text-[9px] font-bold uppercase tracking-wide opacity-80 dark:bg-black/30">
          AI
        </span>
      ) : null}
    </span>
  );
}

export function BookingErrorCell({
  order,
  checking = false,
  finalStatus,
  busy = false,
  onAction,
}: {
  order: OrderRecord;
  checking?: boolean;
  finalStatus?: FinalErrorStatus | null;
  /** The row's quick action is running (e.g. retry in flight). */
  busy?: boolean;
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
  if (isIndiaPostBookingInFlight(order.shipment?.status)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Booking…
      </span>
    );
  }
  const error = orderDisplayError(order, finalStatus);
  if (!error) return <span className="text-xs text-muted">—</span>;
  const action = errorQuickAction(error, unknownOutcome(order, error));
  const ActionIcon = busy ? Loader2 : ACTION_ICON[action];
  const hint = errorActionHint(error, action);
  const exactCode = error.facts.find((fact) => fact.kind === "provider" && fact.code)?.code;

  return (
    <div
      className="flex min-w-0 flex-col items-start gap-1"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex max-w-full items-center gap-1">
        <StatusPill error={error} className="min-w-0" />
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
            variant={action === "open" ? "secondary" : "primary"}
            className={cn(
              "h-6 gap-1 px-2 text-[11px]",
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
  onForce: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const error = orderDisplayError(order, finalStatus);
  const unknown = error ? unknownOutcome(order, error) : false;
  const action = error ? errorQuickAction(error, unknown) : "open";
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
            {error ? <StatusPill error={error} /> : null}
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
            {error && (action === "review" || error.facts.some((fact) => fact.kind === "address")) ? (
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
