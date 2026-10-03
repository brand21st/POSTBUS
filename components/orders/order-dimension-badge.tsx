"use client";

import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Check, Loader2, Package, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { orderNumber } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { isIndiaPostAcceptedStatus, isIndiaPostBookingInFlight } from "@/modules/india-post/booking-status";
import { isParcelArticle } from "@/modules/india-post/article-validator";
import { bookingBoxWeightGrams, hasDeclaredBookingWeight } from "@/modules/orders/weight";
import type { OrderRecord } from "@/types/api";

type Props = {
  order: OrderRecord;
  disabled?: boolean;
};

const PRESETS = [
  { label: "Small Box", length: 15, width: 10, height: 5 },
  { label: "Medium Box", length: 20, width: 15, height: 10 },
  { label: "Apparel / Polybag", length: 25, width: 20, height: 5 },
  { label: "Large Box", length: 30, width: 25, height: 15 },
] as const;

export function OrderDimensionBadge({ order, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const lengthId = useId();
  const widthId = useId();
  const heightId = useId();

  const queryClient = useQueryClient();

  const shipment = order.shipment;
  const length = Number(shipment?.lengthCm ?? shipment?.length_cm ?? 0);
  const width = Number(shipment?.widthCm ?? shipment?.width_cm ?? 0);
  const height = Number(shipment?.heightCm ?? shipment?.height_cm ?? 0);
  const hasDimensions = length > 0 && width > 0 && height > 0;

  const weightGrams = bookingBoxWeightGrams({
    parcelWeightMode: order.parcelWeightMode ?? order.parcel_weight_mode,
    parcelWeightGrams: order.parcelWeightGrams ?? order.parcel_weight_grams,
    lineItems: order.lineItems ?? order.line_items,
    explicitGrams: shipment?.weightGrams ?? shipment?.weight_grams,
  });

  const hasWeight = hasDeclaredBookingWeight({
    parcelWeightMode: order.parcelWeightMode ?? order.parcel_weight_mode,
    parcelWeightGrams: order.parcelWeightGrams ?? order.parcel_weight_grams,
    lineItems: order.lineItems ?? order.line_items,
    explicitGrams: shipment?.weightGrams ?? shipment?.weight_grams,
  });

  const serviceCode =
    shipment?.serviceCode ??
    shipment?.service_code ??
    order.indiaPostService ??
    order.india_post_service ??
    "SP_INLAND_PARCEL";

  const isParcel = isParcelArticle(serviceCode, weightGrams);

  const shipmentStatus = shipment?.status;
  const isLocked =
    Boolean(disabled) ||
    isIndiaPostAcceptedStatus(shipmentStatus) ||
    isIndiaPostBookingInFlight(shipmentStatus);

  const [lengthInput, setLengthInput] = useState("");
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLengthInput(length > 0 ? String(length) : "");
      setWidthInput(width > 0 ? String(width) : "");
      setHeightInput(height > 0 ? String(height) : "");
      setFormError(null);
    }
  }, [open, length, width, height]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { lengthCm: number; widthCm: number; heightCm: number }) => {
      const endpoint = shipment?.id
        ? `/api/v1/shipments/${shipment.id}`
        : `/api/v1/orders/${order.id}/dimensions`;
      return api(endpoint, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast.success("Dimensions saved successfully.");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setOpen(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save dimensions.";
      setFormError(message);
      toast.error(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const l = Number(lengthInput.trim());
    const w = Number(widthInput.trim());
    const h = Number(heightInput.trim());

    if (!Number.isFinite(l) || l < 14 || l > 150) {
      setFormError("Length must be between 14 and 150 cm.");
      return;
    }
    if (!Number.isFinite(w) || w < 9 || w > 150) {
      setFormError("Width must be between 9 and 150 cm.");
      return;
    }
    if (!Number.isFinite(h) || h < 1 || h > 150) {
      setFormError("Height must be between 1 and 150 cm.");
      return;
    }

    saveMutation.mutate({ lengthCm: l, widthCm: w, heightCm: h });
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setLengthInput(String(preset.length));
    setWidthInput(String(preset.width));
    setHeightInput(String(preset.height));
    setFormError(null);
  };

  // Volumetric weight live preview
  const currentL = Number(lengthInput) || 0;
  const currentW = Number(widthInput) || 0;
  const currentH = Number(heightInput) || 0;
  const volumeCm3 = currentL * currentW * currentH;
  const volumetricKg = volumeCm3 > 0 ? (volumeCm3 / 5000).toFixed(2) : null;

  // 1. Non-parcel (e.g. Speed Post DOC)
  if (!isParcel) {
    if (hasDimensions) {
      return (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200/80 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300"
          title={`Document dimensions: ${length} × ${width} × ${height} cm`}
        >
          <Check className="size-3 text-slate-500" aria-hidden="true" />
          <span className="tabular-nums">{length} × {width} × {height} cm</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center whitespace-nowrap rounded-full border border-slate-200/80 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-400"
        title="Speed Post Document — dimensions not required"
      >
        DOC
      </span>
    );
  }

  // 2. Normal parcel cases
  let triggerContent: React.ReactNode;
  let triggerTitle: string;

  if (!hasDimensions && !hasWeight) {
    triggerTitle = isLocked
      ? "Weight and parcel dimensions are missing"
      : "Weight + Dimensions missing. Click to add parcel dimensions.";
    triggerContent = (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-200/80 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800 shadow-2xs transition-all hover:bg-rose-100 hover:border-rose-300 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
        <AlertCircle className="size-3 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <span>Weight + Dims Missing</span>
      </span>
    );
  } else if (!hasDimensions) {
    triggerTitle = isLocked
      ? "Parcel dimensions are missing"
      : "Parcel dimensions missing. Click to add dimensions.";
    triggerContent = (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 shadow-2xs transition-all hover:bg-amber-100 hover:border-amber-300 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>Dimensions Missing</span>
      </span>
    );
  } else if (!hasWeight) {
    triggerTitle = isLocked
      ? "Weight is missing"
      : "Weight missing. Dimensions saved. Click to edit dimensions.";
    triggerContent = (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 shadow-2xs transition-all hover:bg-amber-100 hover:border-amber-300 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>Weight Missing</span>
      </span>
    );
  } else {
    triggerTitle = isLocked
      ? `Parcel dimensions: ${length} × ${width} × ${height} cm (Booked)`
      : `Parcel dimensions: ${length} × ${width} × ${height} cm. Click to edit.`;
    triggerContent = (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-900 shadow-2xs transition-all hover:bg-emerald-100 hover:border-emerald-300 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
        <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span className="tabular-nums">{length} × {width} × {height} cm</span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={isLocked}
        onClick={(e) => {
          e.stopPropagation();
          if (!isLocked) setOpen(true);
        }}
        title={triggerTitle}
        aria-label={triggerTitle}
        className={cn(
          "inline-flex whitespace-nowrap text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 rounded-full",
          !isLocked ? "cursor-pointer active:scale-[0.98]" : "cursor-default opacity-85"
        )}
      >
        {triggerContent}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            <DialogHeader className="gap-1.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <Package className="size-4.5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-ink">
                    Parcel Dimensions
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted">
                    Order {orderNumber(order)} · India Post Parcel
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-3">
              {/* Presets */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted">
                  <Sparkles className="size-3 text-amber-500" />
                  <span>Quick Presets</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-lg border border-border bg-surface-soft px-2 py-1 text-[11px] font-medium text-ink transition hover:border-amber-300 hover:bg-amber-50 active:scale-95 dark:hover:bg-amber-950/30"
                    >
                      {preset.label} ({preset.length}×{preset.width}×{preset.height})
                    </button>
                  ))}
                </div>
              </div>

              {/* Dimension Inputs */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <Label htmlFor={lengthId} className="text-xs font-medium text-ink">
                    Length
                  </Label>
                  <div className="relative flex items-center">
                    <Input
                      id={lengthId}
                      type="number"
                      step="0.1"
                      min={14}
                      max={150}
                      placeholder="20"
                      value={lengthInput}
                      onChange={(e) => setLengthInput(e.target.value)}
                      disabled={saveMutation.isPending}
                      className="h-9 pr-7 text-xs font-semibold tabular-nums"
                      required
                      autoFocus
                    />
                    <span className="pointer-events-none absolute right-2.5 text-[11px] font-medium text-muted">
                      cm
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={widthId} className="text-xs font-medium text-ink">
                    Width
                  </Label>
                  <div className="relative flex items-center">
                    <Input
                      id={widthId}
                      type="number"
                      step="0.1"
                      min={9}
                      max={150}
                      placeholder="15"
                      value={widthInput}
                      onChange={(e) => setWidthInput(e.target.value)}
                      disabled={saveMutation.isPending}
                      className="h-9 pr-7 text-xs font-semibold tabular-nums"
                      required
                    />
                    <span className="pointer-events-none absolute right-2.5 text-[11px] font-medium text-muted">
                      cm
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor={heightId} className="text-xs font-medium text-ink">
                    Height
                  </Label>
                  <div className="relative flex items-center">
                    <Input
                      id={heightId}
                      type="number"
                      step="0.1"
                      min={1}
                      max={150}
                      placeholder="10"
                      value={heightInput}
                      onChange={(e) => setHeightInput(e.target.value)}
                      disabled={saveMutation.isPending}
                      className="h-9 pr-7 text-xs font-semibold tabular-nums"
                      required
                    />
                    <span className="pointer-events-none absolute right-2.5 text-[11px] font-medium text-muted">
                      cm
                    </span>
                  </div>
                </div>
              </div>

              {/* Volumetric Weight / Limits Preview */}
              <div className="flex items-center justify-between rounded-xl bg-surface-soft px-3 py-2 text-[11px] text-muted">
                <span>Limits: L ≥ 14, W ≥ 9, H ≥ 1 cm</span>
                {volumetricKg ? (
                  <span className="font-semibold text-ink">
                    Volumetric: ~{volumetricKg} kg
                  </span>
                ) : null}
              </div>

              {formError ? (
                <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              ) : null}
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save Dimensions"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
