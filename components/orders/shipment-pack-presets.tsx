"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Package, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  SHIPMENT_PRESET_MAX,
  shipmentPresetPackError,
  type ShipmentPreset,
} from "@/modules/shipments/presets";

const QUERY_KEY = ["shipment-presets"];

export const BUILTIN_BOX_SIZES = [
  { label: "Small Box", lengthCm: 15, widthCm: 10, heightCm: 5 },
  { label: "Medium Box", lengthCm: 20, widthCm: 15, heightCm: 10 },
  { label: "Apparel / Polybag", lengthCm: 25, widthCm: 20, heightCm: 5 },
  { label: "Large Box", lengthCm: 30, widthCm: 25, heightCm: 15 },
] as const;

export type BoxSize = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type PackApply = BoxSize & {
  weightGrams: number;
  serviceCode: string;
};

function suggestedName(pack: PackApply) {
  return `${Math.round(pack.weightGrams)}g ${trimNum(pack.lengthCm)}×${trimNum(pack.widthCm)}×${trimNum(pack.heightCm)}`.slice(
    0,
    40
  );
}

function trimNum(value: number) {
  return String(Number(value.toFixed(1))).replace(/\.0$/, "");
}

function sameSize(left: BoxSize, right: BoxSize) {
  return (
    Number(left.lengthCm) === Number(right.lengthCm) &&
    Number(left.widthCm) === Number(right.widthCm) &&
    Number(left.heightCm) === Number(right.heightCm)
  );
}

function samePack(left: PackApply, right: PackApply) {
  return (
    Math.round(left.weightGrams) === Math.round(right.weightGrams) &&
    sameSize(left, right) &&
    left.serviceCode === right.serviceCode
  );
}

function PresetChip({
  label,
  tone,
  selected,
  onApply,
  onRemove,
}: {
  label: string;
  tone: "box" | "saved";
  selected: boolean;
  onApply: () => void;
  onRemove?: () => void;
}) {
  const Icon = tone === "box" ? Package : Bookmark;
  return (
    <div
      className={cn(
        "flex max-w-full items-center rounded-full border",
        tone === "box" &&
          (selected
            ? "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-200"
            : "border-border bg-surface-soft text-ink"),
        tone === "saved" &&
          (selected ? "border-brand bg-brand/10 text-ink" : "border-border bg-surface-soft text-ink")
      )}
    >
      <button
        type="button"
        className="inline-flex min-w-0 items-center gap-1 px-2 py-1 text-left text-[11px] font-medium leading-4"
        onClick={onApply}
      >
        <Icon className={cn("size-3 shrink-0", tone === "box" ? "text-amber-600" : "text-brand")} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-rose-50 hover:text-error"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export function ShipmentPackPresets({
  weightGrams,
  lengthCm,
  widthCm,
  heightCm,
  serviceCode,
  onApply,
  onApplySize,
}: {
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  serviceCode?: string;
  onApply: (pack: PackApply) => void;
  onApplySize: (size: BoxSize) => void;
}) {
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const sizeCurrent: BoxSize | null =
    Number(lengthCm) > 0 && Number(widthCm) > 0 && Number(heightCm) > 0
      ? {
          lengthCm: Number(lengthCm),
          widthCm: Number(widthCm),
          heightCm: Number(heightCm),
        }
      : null;
  const current: PackApply | null =
    sizeCurrent && Number(weightGrams) > 0 && serviceCode
      ? {
          ...sizeCurrent,
          weightGrams: Number(weightGrams),
          serviceCode,
        }
      : null;
  const packError = current ? shipmentPresetPackError(current) : "Enter weight and box size.";
  const canSave = !packError;

  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<ShipmentPreset[]>("/api/v1/shipment-presets"),
  });
  const presets = list.data ?? [];

  const create = useMutation({
    mutationFn: (input: { name: string } & PackApply) =>
      api<ShipmentPreset>("/api/v1/shipment-presets", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      toast.success("Pack size saved.");
      setNaming(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save the pack size."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/shipment-presets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Pack size removed.");
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not remove the pack size."),
  });

  const touch = useMutation({
    mutationFn: (id: string) => api(`/api/v1/shipment-presets/${id}/use`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const activeId = useMemo(() => {
    if (!current) return null;
    return presets.find((item) =>
      samePack(current, {
        weightGrams: item.weightGrams,
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        serviceCode: item.serviceCode,
      })
    )?.id;
  }, [current, presets]);

  function startSave() {
    if (!current || !canSave) {
      toast.error(packError);
      return;
    }
    if (presets.length >= SHIPMENT_PRESET_MAX) {
      toast.error(`You can save up to ${SHIPMENT_PRESET_MAX} pack sizes.`);
      return;
    }
    setName(suggestedName(current));
    setNaming(true);
  }

  function submitName() {
    if (!current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    create.mutate({ name: trimmed, ...current });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="inline-flex items-center gap-1 text-xs font-medium text-muted">
          <Package className="size-3.5 text-amber-600" aria-hidden />
          Pack sizes
        </p>
        {naming && current ? (
          <>
            <Input
              className="h-8 min-w-0 flex-1 text-xs"
              value={name}
              maxLength={40}
              autoFocus
              placeholder="Preset name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitName();
                }
                if (event.key === "Escape") setNaming(false);
              }}
            />
            <Button type="button" size="sm" className="h-8" disabled={create.isPending} onClick={submitName}>
              Save
            </Button>
            <Button type="button" variant="secondary" size="sm" className="h-8" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-auto h-8"
            disabled={!canSave || create.isPending}
            onClick={startSave}
          >
            <Plus className="size-3.5" aria-hidden />
            Save preset
          </Button>
        )}
      </div>

      {list.isPending ? <p className="text-xs text-muted">Loading pack sizes…</p> : null}
      {list.isError ? (
        <p className="text-xs text-muted">
          {list.error instanceof ApiError ? list.error.message : "Could not load pack sizes."}
        </p>
      ) : null}

      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
        {BUILTIN_BOX_SIZES.map((size) => {
          const selected = Boolean(
            sizeCurrent &&
              sameSize(sizeCurrent, size) &&
              !presets.some((preset) => preset.id === activeId && sameSize(preset, size))
          );
          return (
            <PresetChip
              key={size.label}
              tone="box"
              label={`${size.label} ${size.lengthCm}×${size.widthCm}×${size.heightCm}`}
              selected={selected}
              onApply={() => onApplySize(size)}
            />
          );
        })}
        {presets.map((preset) => {
          const pack: PackApply = {
            weightGrams: preset.weightGrams,
            lengthCm: preset.lengthCm,
            widthCm: preset.widthCm,
            heightCm: preset.heightCm,
            serviceCode: preset.serviceCode,
          };
          return (
            <PresetChip
              key={preset.id}
              tone="saved"
              label={`${preset.name} · ${Math.round(preset.weightGrams)} g · ${trimNum(preset.lengthCm)}×${trimNum(preset.widthCm)}×${trimNum(preset.heightCm)}`}
              selected={preset.id === activeId}
              onApply={() => {
                onApply(pack);
                touch.mutate(preset.id);
              }}
              onRemove={() => {
                const ok = window.confirm(`Remove pack size “${preset.name}”?`);
                if (!ok) return;
                remove.mutate(preset.id);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
