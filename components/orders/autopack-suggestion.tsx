"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AiMark, AiPill } from "@/components/ui/ai-mark";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import type { PackageDecision } from "@/modules/autopack/decide";

type Recommendation = {
  orderId: string;
  shipmentId: string | null;
  decision: PackageDecision;
  autoSelectionEnabled: boolean;
};

export type AutoPackPick = { lengthCm: number; widthCm: number; heightCm: number; evidenceId: string };

/** Review reasons worth showing. "No history" and "no variant ids" are the normal case and stay quiet. */
const SHOWN_REVIEW_REASONS = new Set(["UNCONFIRMED_HISTORY", "CONFLICTING_HISTORY", "INVALID_FOR_SERVICE"]);

function trim(value: number) {
  return String(Math.round(value * 10) / 10);
}

/**
 * Shows the past box AutoPack would use for this exact order (Shopify only).
 * "Apply size" only fills the form; the merchant still saves. "Not right" stops the suggestion for this order.
 */
export function AutoPackSuggestion({
  orderId,
  enabled,
  applied,
  onUse,
}: {
  orderId: string;
  enabled: boolean;
  /** The form currently holds this suggestion's box. */
  applied?: boolean;
  onUse: (pick: AutoPackPick) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["autopack", orderId];
  const recommendation = useQuery({
    queryKey,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: () => api<Recommendation>(`/api/v1/autopack/orders/${orderId}`),
  });

  const reject = useMutation({
    mutationFn: (evidenceId: string) =>
      api(`/api/v1/autopack/orders/${orderId}/reject`, {
        method: "POST",
        body: JSON.stringify({ evidenceId }),
      }),
    onSuccess: () => {
      toast.success("Got it. AutoPack won't suggest that box for this order again.");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reject the suggestion."),
  });

  if (!enabled) return null;

  if (recommendation.isPending) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-violet-200/70 bg-violet-50/40 px-3 py-2.5 dark:border-violet-900/40 dark:bg-violet-950/20">
        <AiMark size="sm" className="animate-pulse motion-reduce:animate-none" />
        <span className="text-xs text-muted">AutoPack is checking past boxes for these items…</span>
      </div>
    );
  }

  const decision = recommendation.data?.decision;
  if (!decision) return null;

  if (decision.kind === "MANUAL_REVIEW_REQUIRED") {
    if (!SHOWN_REVIEW_REASONS.has(decision.reason)) return null;
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-soft/60 px-3 py-2.5">
        <AiMark size="sm" className="mt-px opacity-80" />
        <p className="text-xs leading-5 text-muted">
          <span className="font-semibold text-ink">AutoPack · </span>
          {decision.message}
        </p>
      </div>
    );
  }

  if (decision.kind !== "SAVED_PACKAGE" && decision.kind !== "CUSTOM_DIMENSIONS") return null;
  if (decision.evidence.type !== "history") return null;
  const evidenceId = decision.evidence.historyId;
  const measured = decision.evidence.level === "verified";
  const box = decision.box;

  return (
    <section
      aria-label="AutoPack suggestion"
      className={cn(
        "relative overflow-hidden rounded-xl p-px",
        applied
          ? "bg-emerald-300/70 dark:bg-emerald-800/60"
          : "bg-gradient-to-br from-rose-400/60 via-fuchsia-400/50 to-violet-500/60"
      )}
    >
      <div className="rounded-[11px] bg-card px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <AiMark />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-semibold text-ink">AutoPack suggestion</p>
              <AiPill />
            </div>
            <p className="mt-0.5 text-[15px] font-semibold tabular-nums tracking-tight text-ink">
              {trim(box.lengthCm)} × {trim(box.widthCm)} × {trim(box.heightCm)}
              <span className="ml-1 text-xs font-medium text-muted">cm</span>
              {decision.kind === "SAVED_PACKAGE" ? (
                <span className="ml-1.5 text-xs font-medium text-muted">· {decision.presetName}</span>
              ) : null}
            </p>
            <p className="mt-1 flex items-center gap-1 text-[11px] leading-4 text-muted">
              {measured ? (
                <ShieldCheck className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <Info className="size-3 shrink-0" aria-hidden />
              )}
              {measured ? "Measured box used before for these exact items" : "Booked before for these exact items · not marked measured"}
            </p>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2 pl-[42px]">
          {applied ? (
            <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check className="size-3.5" aria-hidden />
              Applied. Save to keep it
            </span>
          ) : (
            <Button type="button" size="xs" onClick={() => onUse({ ...box, evidenceId })}>
              <Check className="size-3.5" aria-hidden />
              Apply size
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted"
            disabled={reject.isPending}
            onClick={() => reject.mutate(evidenceId)}
          >
            <Undo2 className="size-3.5" aria-hidden />
            Not right
          </Button>
        </div>
      </div>
    </section>
  );
}
