"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2, Package, Scale, Zap } from "lucide-react";
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
import { ShipmentPackPresets } from "@/components/orders/shipment-pack-presets";
import { AutoPackSuggestion, type AutoPackPick } from "@/components/orders/autopack-suggestion";
import { Checkbox } from "@/components/ui/checkbox";
import { AiMark } from "@/components/ui/ai-mark";
import { orderNumber } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { indiaPostStatusOf, isIndiaPostAcceptedStatus, isIndiaPostBookingInFlight } from "@/modules/india-post/booking-status";
import { dimensionSourceLabel, dimensionSourceShort, formatParcelSize, readParcelDimensionSource } from "@/modules/shopify/dimensions";
import { isStrictParcelDimensionsOrg } from "@/modules/shopify/strict-parcel-dimensions";
import { useMe } from "@/lib/hooks/use-me";
import { isParcelArticle } from "@/modules/india-post/article-validator";
import { bookingBoxWeightGrams, hasDeclaredBookingWeight } from "@/modules/orders/weight";
import type { OrderRecord } from "@/types/api";

type Props = {
  order: OrderRecord;
  disabled?: boolean;
  /** Table button asks the page to open one dialog outside the row. */
  onEdit?: () => void;
  /** Renders only the editor, owned by the page so a table refresh cannot close it. */
  dialogOnly?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const WEIGHT_PRESETS = [
  { label: "250g", weight: 250 },
  { label: "500g", weight: 500 },
  { label: "1kg", weight: 1000 },
  { label: "1.5kg", weight: 1500 },
  { label: "2kg", weight: 2000 },
] as const;

function ParcelPill({
  tone,
  className,
  children,
}: {
  tone: "ok" | "action" | "locked" | "neutral";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4",
        className,
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

export function OrderDimensionBadge({ order, disabled, onEdit, dialogOnly, open: openProp, onOpenChange }: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = dialogOnly ? Boolean(openProp) : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (dialogOnly) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };
  const openedAt = useRef(0);
  if (open && openedAt.current === 0) openedAt.current = performance.now();
  if (!open && openedAt.current !== 0) openedAt.current = 0;
  const requestOpenChange = (next: boolean) => {
    if (!next && performance.now() - openedAt.current < 500) return;
    setOpen(next);
  };
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
  const me = useMe();
  const strictOrg = isStrictParcelDimensionsOrg(me.data?.organization?.id);
  const dimensionSource = readParcelDimensionSource(
    (shipment as { metadata?: unknown } | null | undefined)?.metadata
  );
  const sourceLabel = dimensionSourceLabel(dimensionSource);
  const sourceShort = dimensionSourceShort(dimensionSource);
  const sizeLabel = formatParcelSize(length, width, height);
  const compactSize = sizeLabel.replace(" cm", "").replaceAll(" × ", "×");

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
  const shipmentStatusName = indiaPostStatusOf(shipmentStatus);
  const isLocked =
    Boolean(disabled) ||
    isIndiaPostAcceptedStatus(shipmentStatus) ||
    (isIndiaPostBookingInFlight(shipmentStatus) && shipmentStatusName !== "QUEUED");

  const lineItemsList = (order.lineItems ?? order.line_items ?? []).filter(
    (item): item is typeof item & { id: string } => Boolean(item.id)
  );

  // Controlled form states
  const [lengthInput, setLengthInput] = useState(() => (length > 0 ? String(length) : ""));
  const [widthInput, setWidthInput] = useState(() => (width > 0 ? String(width) : ""));
  const [heightInput, setHeightInput] = useState(() => (height > 0 ? String(height) : ""));
  const [boxWeightInput, setBoxWeightInput] = useState(() => {
    const savedBox = Number(
      order.parcelWeightGrams ?? order.parcel_weight_grams ?? shipment?.weightGrams ?? shipment?.weight_grams
    );
    if (Number.isFinite(savedBox) && savedBox > 0) return String(Math.round(savedBox));
    if (currentWeightGrams > 0) return String(Math.round(currentWeightGrams));
    return "";
  });
  const [itemWeights, setItemWeights] = useState<Record<string, string>>(() => {
    const initialWeights: Record<string, string> = {};
    lineItemsList.forEach((item) => {
      const g = Number(item.weightGrams ?? item.weight_grams);
      initialWeights[item.id] = Number.isFinite(g) && g > 0 ? String(Math.round(g)) : "";
    });
    return initialWeights;
  });
  const [formError, setFormError] = useState<string | null>(null);
  // Where the box came from: a saved pack size, an AutoPack suggestion, or typed.
  const [pickedPresetId, setPickedPresetId] = useState<string | null>(null);
  const [autopackPick, setAutopackPick] = useState<AutoPackPick | null>(null);
  const [measured, setMeasured] = useState(false);
  const isShopifyOrder = String(order.source ?? "").toUpperCase() === "SHOPIFY";

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
      setPickedPresetId(null);
      setAutopackPick(null);
      setMeasured(false);
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
      presetId?: string;
      autopackEvidenceId?: string;
      measured?: boolean;
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
      queryClient.invalidateQueries({ queryKey: ["autopack", order.id] });
      if (shipment?.id) {
        queryClient.invalidateQueries({ queryKey: ["shipment", shipment.id] });
        queryClient.invalidateQueries({ queryKey: ["booking-retry", shipment.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      queryClient.invalidateQueries({ queryKey: ["order-error-status"] });
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

    // The suggestion only counts if the box was not edited afterwards.
    const usedSuggestion =
      autopackPick &&
      autopackPick.lengthCm === l &&
      autopackPick.widthCm === w &&
      autopackPick.heightCm === h
        ? autopackPick.evidenceId
        : undefined;

    saveMutation.mutate({
      lengthCm: l,
      widthCm: w,
      heightCm: h,
      boxWeightGrams: Number.isFinite(bWeight) && bWeight > 0 ? Math.round(bWeight) : undefined,
      lineItems: lineItemsPayload.length > 0 ? lineItemsPayload : undefined,
      ...(usedSuggestion ? { autopackEvidenceId: usedSuggestion } : {}),
      ...(!usedSuggestion && pickedPresetId ? { presetId: pickedPresetId } : {}),
      ...(measured ? { measured: true } : {}),
    });
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

  const needsSetup = !hasDimensions || !hasWeight;

  // 1. Non-parcel (e.g. Speed Post DOC)
  if (!isParcel) {
    if (hasDimensions) {
      return (
        <ParcelPill tone="neutral">
          <span className="tabular-nums" title={`Document: ${sizeLabel}`}>
            {compactSize}
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
    ? " This shipment is already with India Post and its size cannot be changed."
    : strictOrg
      ? " Parcel length, width, and height are required before booking unless Settings has a default package."
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
        <span className="text-[11px] font-medium tabular-nums text-muted">{compactSize}</span>
        <ParcelPill tone={missingTone}>
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          <span>No wt</span>
        </ParcelPill>
      </span>
    );
  } else {
    triggerTitle = isLocked
      ? `Parcel ${sizeLabel} · ${currentWeightGrams}g · Booked${sourceLabel ? ` · ${sourceLabel}` : ""}`
      : `Parcel ${sizeLabel} · ${currentWeightGrams}g · Click to edit${sourceLabel ? ` · ${sourceLabel}` : ""}`;
    triggerContent = (
      <span className="flex min-w-0 flex-col items-start gap-0.5 whitespace-normal leading-none">
        <ParcelPill tone="ok" className="max-w-full overflow-hidden">
          <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span className="min-w-0 truncate tabular-nums font-medium">{compactSize}</span>
        </ParcelPill>
        <span className="max-w-full truncate px-0.5 text-[10px] font-medium tabular-nums text-muted">
          {currentWeightGrams > 0 ? `${currentWeightGrams}g` : null}
          {currentWeightGrams > 0 && sourceShort ? " · " : null}
          {sourceShort}
        </span>
      </span>
    );
  }

  const dialog = (
      <Dialog open={open} onOpenChange={requestOpenChange}>
        <DialogContent
          className="sm:max-w-md max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(event) => {
            if (performance.now() - openedAt.current < 500) event.preventDefault();
          }}
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
                    Order <span className="font-medium text-ink">{orderNumber(order)}</span>
                    {hasWeight ? <> · {currentWeightGrams} g</> : null}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-3">
              {needsSetup ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                  <p>
                    {!hasDimensions && !hasWeight
                      ? "Add the box size to book. Empty weight uses your Settings weight, or 100 g."
                      : !hasDimensions
                        ? "Add the box size to book this parcel."
                        : "Size is saved. Empty weight uses your Settings weight, or 100 g."}
                    {!hasDimensions ? (
                      <span className="text-amber-800/80 dark:text-amber-300/80"> Not needed if Settings has a default package.</span>
                    ) : null}
                  </p>
                </div>
              ) : null}

              <AutoPackSuggestion
                orderId={String(order.id)}
                enabled={open && isShopifyOrder && !isLocked}
                applied={
                  autopackPick != null &&
                  Number(lengthInput) === autopackPick.lengthCm &&
                  Number(widthInput) === autopackPick.widthCm &&
                  Number(heightInput) === autopackPick.heightCm
                }
                onUse={(pick) => {
                  setLengthInput(String(pick.lengthCm));
                  setWidthInput(String(pick.widthCm));
                  setHeightInput(String(pick.heightCm));
                  setAutopackPick(pick);
                  setPickedPresetId(null);
                  setFormError(null);
                }}
              />

              <ShipmentPackPresets
                weightGrams={Number(boxWeightInput) || undefined}
                lengthCm={Number(lengthInput) || undefined}
                widthCm={Number(widthInput) || undefined}
                heightCm={Number(heightInput) || undefined}
                serviceCode={serviceCode}
                onApplySize={(size) => {
                  setLengthInput(String(size.lengthCm));
                  setWidthInput(String(size.widthCm));
                  setHeightInput(String(size.heightCm));
                  setPickedPresetId(null);
                  setAutopackPick(null);
                  setFormError(null);
                }}
                onApply={(pack) => {
                  setLengthInput(String(pack.lengthCm));
                  setWidthInput(String(pack.widthCm));
                  setHeightInput(String(pack.heightCm));
                  setBoxWeightInput(String(Math.round(pack.weightGrams)));
                  setPickedPresetId(pack.presetId ?? null);
                  setAutopackPick(null);
                  setFormError(null);
                }}
              />

              {/* Box size */}
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-semibold text-ink">
                  <span>Box size</span>
                  <span className="text-[11px] font-normal text-muted">cm · L × W × H</span>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: lengthId, label: "Length", min: 14, example: "20", value: lengthInput, set: setLengthInput },
                      { id: widthId, label: "Width", min: 9, example: "15", value: widthInput, set: setWidthInput },
                      { id: heightId, label: "Height", min: 1, example: "10", value: heightInput, set: setHeightInput },
                    ] as const
                  ).map((field, index) => (
                    <div key={field.label} className="space-y-1">
                      <Label htmlFor={field.id} className="text-[11px] font-medium text-muted">
                        {field.label}
                      </Label>
                      <div className="relative flex items-center">
                        <Input
                          id={field.id}
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min={field.min}
                          max={150}
                          placeholder={`e.g. ${field.example}`}
                          value={field.value}
                          onChange={(e) => field.set(e.target.value)}
                          disabled={saveMutation.isPending}
                          className="h-10 pr-8 text-sm font-semibold tabular-nums placeholder:font-normal placeholder:text-muted/50"
                          required
                          autoFocus={index === 0 && !autopackPick}
                        />
                        <span className="pointer-events-none absolute right-2.5 text-[11px] font-medium text-muted">cm</span>
                      </div>
                      <p className="text-[10px] text-muted/80">min {field.min}</p>
                    </div>
                  ))}
                </div>
              </fieldset>

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
                          className="inline-flex items-center gap-0.5 rounded-md px-1 text-[10px] font-medium text-muted transition hover:bg-card hover:text-ink"
                          title="Set box weight from total item weights"
                        >
                          <Zap className="size-2.5" aria-hidden />
                          <span>Use items total · {itemsTotalWeight} g</span>
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
                <span>{volumetricGrams > 0 ? "Billed on the higher of actual and volumetric weight" : "Enter the box size to see the billable weight"}</span>
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

              {isShopifyOrder ? (
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition",
                    measured
                      ? "border-violet-300 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/30"
                      : "border-border hover:border-violet-200 hover:bg-violet-50/30 dark:hover:border-violet-900"
                  )}
                >
                  <Checkbox
                    checked={measured}
                    onCheckedChange={(value) => setMeasured(value === true)}
                    disabled={saveMutation.isPending}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1 text-[11px] leading-4 text-muted">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      I measured this box
                      <AiMark size="xs" />
                    </span>
                    <span className="mt-0.5 block">
                      AutoPack can reuse this size for orders with exactly the same items and quantities, when AutoPack
                      box selection is on in Automation.
                    </span>
                  </span>
                </label>
              ) : null}

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
  );

  if (dialogOnly) return dialog;

  return (
    <>
      <button
        type="button"
        disabled={isLocked}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isLocked) return;
          if (onEdit) onEdit();
          else setOpen(true);
        }}
        title={triggerTitle}
        aria-label={triggerTitle}
        className={cn(
          "inline-flex w-full min-w-0 max-w-full text-left whitespace-normal transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 rounded-md",
          !isLocked ? "cursor-pointer active:scale-[0.98]" : "cursor-default"
        )}
      >
        {triggerContent}
      </button>
      {onEdit ? null : dialog}
    </>
  );
}
