"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/hooks/use-api";
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
 * "Use this" only fills the form; the merchant still saves. "Not right" stops the suggestion for this order.
 */
export function AutoPackSuggestion({
  orderId,
  enabled,
  onUse,
}: {
  orderId: string;
  enabled: boolean;
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
      toast.success("AutoPack will not suggest that box for this order again.");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reject the suggestion."),
  });

  const decision = recommendation.data?.decision;
  if (!enabled || !decision) return null;

  if (decision.kind === "MANUAL_REVIEW_REQUIRED") {
    if (!SHOWN_REVIEW_REASONS.has(decision.reason)) return null;
    return (
      <p className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
        <Sparkles className="mr-1 inline size-3 text-brand" aria-hidden />
        AutoPack: {decision.message}
      </p>
    );
  }

  if (decision.kind !== "SAVED_PACKAGE" && decision.kind !== "CUSTOM_DIMENSIONS") return null;
  if (decision.evidence.type !== "history") return null;
  const evidenceId = decision.evidence.historyId;
  const measured = decision.evidence.level === "verified";
  const box = decision.box;

  return (
    <div className="space-y-1.5 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2">
      <p className="text-[11px] leading-4 text-ink">
        <Sparkles className="mr-1 inline size-3 text-brand" aria-hidden />
        <span className="font-semibold">
          AutoPack: {trim(box.lengthCm)} × {trim(box.widthCm)} × {trim(box.heightCm)} cm
        </span>
        {decision.kind === "SAVED_PACKAGE" ? ` (${decision.presetName})` : ""}
        <span className="text-muted">
          {" "}
          · {measured ? "Measured box" : "Booked before, not marked measured"} for these exact items
        </span>
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUse({ ...box, evidenceId })}
        >
          Use this
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 text-xs"
          disabled={reject.isPending}
          onClick={() => reject.mutate(evidenceId)}
        >
          Not right
        </Button>
      </div>
    </div>
  );
}
