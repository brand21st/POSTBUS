"use client";

import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2, Package, Scale, Sparkles, Zap } from "lucide-react";
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

const DIMENSION_PRESETS = [
  { label: "Small Box", length: 15, width: 10, height: 5 },
  { label: "Medium Box", length: 20, width: 15, height: 10 },
  { label: "Apparel / Polybag", length: 25, width: 20, height: 5 },
  { label: "Large Box", length: 30, width: 25, height: 15 },
] as const;

const WEIGHT_PRESETS = [
  { label: "250g", weight: 250 },
  { label: "500g", weight: 500 },
  { label: "1kg", weight: 1000 },
  { label: "1.5kg", weight: 1500 },
  { label: "2kg", weight: 2000 },
] as const;

function ParcelPill({
  tone,
  children,
}: {
  tone: "ok" | "action" | "locked" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4",
        tone === "ok" &&
          "border border-emerald-200/80 bg-emerald-50 text-emerald-900 shadow-2xs transition-colors hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
        tone === "action" &&
          "border border-red-300 bg-red-100 text-red-950 shadow-2xs transition-all hover:border-red-400 hover:bg-red-200 hover:shadow-sm dark:border-red-800 dark:bg-red-950/70 dark:text-red-100",
        tone === "locked" &&
          "border border-red-300/80 bg-red-100/90 text-red-950 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100",
        tone === "neutral" &&
          "border border-slate-200/80 bg-slate-50 font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300"
      )}
    >
      {children}
    </span>
  );
}

export function OrderDimensionBadge({ order, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const lengthId = useId();
  const widthId = useId();
  const heightId = useId();
  const boxWeightId = useId();

  const queryClient = useQueryClient();

  const shipment = order.shipment;
  const length = Number(shipment?.lengthCm ?? shipment?.length_cm ?? 0);
  const width = Number(shipment?.widthCm ?? shipment?.width_cm ?? 0);
  const height = Number(shipment?.heightCm ?? shipment?.height_cm ?? 0);
  const hasDimensions = length > 0 && width > 0 && height > 0;

  const currentWeightGrams = bookingBoxWeightGrams({
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

  const isParcel = isParcelArticle(serviceCode, currentWeightGrams);

  const shipmentStatus = shipment?.status;
  const isLocked =
    Boolean(disabled) ||
    isIndiaPostAcceptedStatus(shipmentStatus) ||
    isIndiaPostBookingInFlight(shipmentStatus);

  const lineItemsList = (order.lineItems ?? order.line_items ?? []).filter(
    (item): item is typeof item & { id: string } => Boolean(item.id)
  );

  // Controlled form states
  const [lengthInput, setLengthInput] = useState("");
  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [boxWeightInput, setBoxWeightInput] = useState("");
  const [itemWeights, setItemWeights] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLengthInput(length > 0 ? String(length) : "");
      setWidthInput(width > 0 ? String(width) : "");
      setHeightInput(height > 0 ? String(height) : "");

      const initialWeights: Record<string, string> = {};
      lineItemsList.forEach((item) => {
        const g = Number(item.weightGrams ?? item.weight_grams);
        initialWeights[item.id] = Number.isFinite(g) && g > 0 ? String(Math.round(g)) : "";
      });
      setItemWeights(initialWeights);

      const savedBox = Number(order.parcelWeightGrams ?? order.parcel_weight_grams ?? shipment?.weightGrams ?? shipment?.weight_grams);
      if (Number.isFinite(savedBox) && savedBox > 0) {
        setBoxWeightInput(String(Math.round(savedBox)));
      } else if (currentWeightGrams > 0) {
        setBoxWeightInput(String(Math.round(currentWeightGrams)));
      } else {
        setBoxWeightInput("");
      }

      setFormError(null);
    }
  }, [open, length, width, height, currentWeightGrams]);

  // Compute live item weight sum
  const itemsTotalWeight = lineItemsList.reduce((sum, item) => {
    const entered = Number(itemWeights[item.id]);
    const qty = Number(item.quantity) || 1;
    return sum + (Number.isFinite(entered) && entered > 0 ? entered * qty : 0);
  }, 0);

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      lengthCm: number;
      widthCm: number;
      heightCm: number;
      boxWeightGrams?: number;
      lineItems?: Array<{ id: string; weightGrams: number; weightMode: "auto" | "manual" }>;
    }) => {
      const endpoint = shipment?.id
        ? `/api/v1/shipments/${shipment.id}`
        : `/api/v1/orders/${order.id}/dimensions`;
      return api(endpoint, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast.success("Parcel dimensions and weight saved successfully.");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      setOpen(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save dimensions and weight.";
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
    const bWeight = Number(boxWeightInput.trim());

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

    if (boxWeightInput.trim() && (!Number.isFinite(bWeight) || bWeight < 1)) {
      setFormError("Box weight must be at least 1 g.");
      return;
    }

    const lineItemsPayload = lineItemsList.map((item) => ({
      id: item.id,
      weightGrams: Math.max(0, Math.round(Number(itemWeights[item.id]) || 0)),
      weightMode: "manual" as const,
    }));

    saveMutation.mutate({
      lengthCm: l,
      widthCm: w,
      heightCm: h,
      boxWeightGrams: Number.isFinite(bWeight) && bWeight > 0 ? Math.round(bWeight) : undefined,
      lineItems: lineItemsPayload.length > 0 ? lineItemsPayload : undefined,
    });
  };

  const applyDimensionPreset = (preset: (typeof DIMENSION_PRESETS)[number]) => {
    setLengthInput(String(preset.length));
    setWidthInput(String(preset.width));
    setHeightInput(String(preset.height));
    setFormError(null);
  };

  const applyWeightPreset = (preset: (typeof WEIGHT_PRESETS)[number]) => {
    setBoxWeightInput(String(preset.weight));
    setFormError(null);
  };

  const syncBoxFromItems = () => {
    if (itemsTotalWeight > 0) {
      setBoxWeightInput(String(Math.round(itemsTotalWeight)));
      setFormError(null);
    }
  };

  // Volumetric weight live preview
  const currentL = Number(lengthInput) || 0;
  const currentW = Number(widthInput) || 0;
  const currentH = Number(heightInput) || 0;
  const volumeCm3 = currentL * currentW * currentH;
  const volumetricGrams = volumeCm3 > 0 ? Math.round((volumeCm3 / 5000) * 1000) : 0;
  const parsedBoxWeight = Number(boxWeightInput) || 0;
  const billableWeightGrams = Math.max(parsedBoxWeight, volumetricGrams);

  const sizeLabel = `${length} × ${width} × ${height} cm`;
  const needsSetup = !hasDimensions || !hasWeight;

  // 1. Non-parcel (e.g. Speed Post DOC)
  if (!isParcel) {
    if (hasDimensions) {
      return (
        <ParcelPill tone="neutral">
          <span className="tabular-nums" title={`Document: ${sizeLabel}`}>
            {sizeLabel}
          </span>
        </ParcelPill>
      );
    }
    return (
      <ParcelPill tone="neutral">
        <span title="Speed Post Document — size not required">DOC</span>
      </ParcelPill>
    );
  }

  const optionalHint = isLocked
    ? " You can still ship; India Post uses Settings defaults when these are empty."
    : " Optional — click to add. If skipped, India Post uses Settings → Shipping defaults.";

  let triggerContent: React.ReactNode;
  let triggerTitle: string;
  const missingTone = isLocked ? "locked" : "action";

  if (!hasDimensions && !hasWeight) {
    triggerTitle = `Dimensions missing. Weight missing.${optionalHint}`;
    triggerContent = (
      <ParcelPill tone={missingTone}>
        <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
        <span>Size · wt</span>
      </ParcelPill>
    );
  } else if (!hasDimensions) {
    triggerTitle = `Weight ${currentWeightGrams}g saved. Dimensions missing.${optionalHint}`;
    triggerContent = (
      <span className="flex items-center gap-1">
        {hasWeight ? (
          <span className="text-[11px] font-medium tabular-nums text-muted">{currentWeightGrams}g</span>
        ) : null}
        <ParcelPill tone={missingTone}>
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          <span>No size</span>
        </ParcelPill>
      </span>
    );
  } else if (!hasWeight) {
    triggerTitle = `${sizeLabel} saved. Weight missing.${optionalHint}`;
    triggerContent = (
      <span className="flex items-center gap-1">
        <span className="text-[11px] font-medium tabular-nums text-muted">
          {length}×{width}×{height}
        </span>
        <ParcelPill tone={missingTone}>
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          <span>No wt</span>
        </ParcelPill>
      </span>
    );
  } else {
    triggerTitle = isLocked
      ? `Parcel ${sizeLabel} · ${currentWeightGrams}g · Booked`
      : `Parcel ${sizeLabel} · ${currentWeightGrams}g · Click to edit`;
    triggerContent = (
      <ParcelPill tone="ok">
        <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span className="tabular-nums font-medium">
          {length}×{width}×{height}
          {currentWeightGrams > 0 ? ` · ${currentWeightGrams}g` : ""}
        </span>
      </ParcelPill>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={isLocked}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!isLocked) setOpen(true);
        }}
        title={triggerTitle}
        aria-label={triggerTitle}
        className={cn(
          "inline-flex max-w-full text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 rounded-full",
          !isLocked ? "cursor-pointer active:scale-[0.98]" : "cursor-default"
        )}
      >
        {triggerContent}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-md max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            <DialogHeader className="gap-1.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl",
                    needsSetup
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  )}
                >
                  <Package className="size-4.5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-ink">
                    {needsSetup ? "Add parcel size" : "Edit parcel"}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted">
                    Order {orderNumber(order)} · Optional. Empty fields use Settings defaults at booking.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-3">
              {needsSetup ? (
                <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {!hasDimensions && !hasWeight
                    ? "You can still ship without entering these. India Post booking will use Settings → Shipping defaults (or 14 × 9 × 1 cm and 100 g)."
                    : !hasDimensions
                      ? `Weight is ${currentWeightGrams}g. Size is optional — add L × W × H here, or booking uses Settings defaults.`
                      : "Size is saved. Weight is optional — add it here, or booking uses the Settings default weight."}
                </p>
              ) : null}

              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted">
                  <Sparkles className="size-3 text-amber-500" />
                  <span>Quick box size</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DIMENSION_PRESETS.map((preset) => {
                    const selected =
                      Number(lengthInput) === preset.length &&
                      Number(widthInput) === preset.width &&
                      Number(heightInput) === preset.height;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => applyDimensionPreset(preset)}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] font-medium transition active:scale-95",
                          selected
                            ? "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-200"
                            : "border-border bg-surface-soft text-ink hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        )}
                      >
                        {preset.label}
                        <span className="ml-1 tabular-nums text-muted">
                          {preset.length}×{preset.width}×{preset.height}
                        </span>
                      </button>
                    );
                  })}
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

              {/* Weight Section */}
              <div className="space-y-2 rounded-xl border border-border/80 bg-surface-soft/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Scale className="size-3.5 text-brand" />
                    <span>Weight & Packaging</span>
                  </div>
                  {/* Quick Weight Presets */}
                  <div className="flex items-center gap-1">
                    {WEIGHT_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyWeightPreset(p)}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition",
                          Number(boxWeightInput) === p.weight
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-border bg-card text-ink hover:border-brand hover:text-brand"
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  {/* Item Weight */}
                  {lineItemsList.length === 1 ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`item-wt-${lineItemsList[0].id}`} className="text-[11px] font-medium text-muted truncate max-w-[140px]" title={lineItemsList[0].title}>
                          Item weight (g)
                        </Label>
                        <span className="text-[10px] text-muted truncate max-w-[100px]" title={lineItemsList[0].title}>
                          {lineItemsList[0].title}
                        </span>
                      </div>
                      <div className="relative flex items-center">
                        <Input
                          id={`item-wt-${lineItemsList[0].id}`}
                          type="number"
                          min={0}
                          placeholder="450"
                          value={itemWeights[lineItemsList[0].id] ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setItemWeights((prev) => ({ ...prev, [lineItemsList[0].id]: val }));
                            if (val && (!boxWeightInput || Number(boxWeightInput) === 0)) {
                              setBoxWeightInput(val);
                            }
                          }}
                          disabled={saveMutation.isPending}
                          className="h-8 pr-7 text-xs font-medium tabular-nums bg-card"
                        />
                        <span className="pointer-events-none absolute right-2 text-[11px] font-medium text-muted">
                          g
                        </span>
                      </div>
                    </div>
                  ) : lineItemsList.length > 1 ? (
                    <div className="col-span-full space-y-1.5">
                      <Label className="text-[11px] font-medium text-muted">
                        Item weights (g)
                      </Label>
                      <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                        {lineItemsList.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] truncate flex-1 text-ink" title={item.title}>
                              {item.title} <span className="text-muted">×{item.quantity}</span>
                            </span>
                            <div className="relative flex items-center w-24 shrink-0">
                              <Input
                                type="number"
                                min={0}
                                placeholder="200"
                                value={itemWeights[item.id] ?? ""}
                                onChange={(e) =>
                                  setItemWeights((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                disabled={saveMutation.isPending}
                                className="h-7 pr-6 text-xs tabular-nums bg-card"
                              />
                              <span className="pointer-events-none absolute right-1.5 text-[10px] text-muted">
                                g
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Box Weight */}
                  <div className={cn("space-y-1", lineItemsList.length > 1 && "col-span-full")}>
                    <div className="flex items-center justify-between">
                      <Label htmlFor={boxWeightId} className="text-[11px] font-medium text-ink">
                        Box weight (g)
                      </Label>
                      {itemsTotalWeight > 0 ? (
                        <button
                          type="button"
                          onClick={syncBoxFromItems}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand hover:underline"
                          title="Set box weight from total item weights"
                        >
                          <Zap className="size-2.5" />
                          <span>Use items sum ({itemsTotalWeight}g)</span>
                        </button>
                      ) : null}
                    </div>
                    <div className="relative flex items-center">
                      <Input
                        id={boxWeightId}
                        type="number"
                        min={1}
                        placeholder="500"
                        value={boxWeightInput}
                        onChange={(e) => setBoxWeightInput(e.target.value)}
                        disabled={saveMutation.isPending}
                        className="h-8 pr-7 text-xs font-semibold tabular-nums bg-card"
                      />
                      <span className="pointer-events-none absolute right-2 text-[11px] font-medium text-muted">
                        g
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Volumetric Weight & Tariff Live Preview */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl bg-surface-soft px-3 py-2 text-[11px] text-muted">
                <span>Limits: L ≥ 14, W ≥ 9, H ≥ 1 cm</span>
                <div className="flex items-center gap-2 font-medium text-ink">
                  {volumetricGrams > 0 ? (
                    <span title="Volumetric weight: (L × W × H) / 5000">
                      Vol: ~{(volumetricGrams / 1000).toFixed(2)} kg
                    </span>
                  ) : null}
                  {billableWeightGrams > 0 ? (
                    <span className="font-semibold text-brand">
                      Tariff: {billableWeightGrams} g
                    </span>
                  ) : null}
                </div>
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
                ) : needsSetup ? (
                  "Save parcel"
                ) : (
                  "Update parcel"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
