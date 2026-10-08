"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
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

export type PackApply = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
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

function samePack(left: PackApply, right: PackApply) {
  return (
    Math.round(left.weightGrams) === Math.round(right.weightGrams) &&
    Number(left.lengthCm) === Number(right.lengthCm) &&
    Number(right.widthCm) === Number(left.widthCm) &&
    Number(left.heightCm) === Number(right.heightCm) &&
    left.serviceCode === right.serviceCode
  );
}

export function ShipmentPackPresets({
  weightGrams,
  lengthCm,
  widthCm,
  heightCm,
  serviceCode,
  onApply,
}: {
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  serviceCode?: string;
  onApply: (pack: PackApply) => void;
}) {
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const current: PackApply | null =
    Number(weightGrams) > 0 && Number(lengthCm) > 0 && Number(widthCm) > 0 && Number(heightCm) > 0 && serviceCode
      ? {
          weightGrams: Number(weightGrams),
          lengthCm: Number(lengthCm),
          widthCm: Number(widthCm),
          heightCm: Number(heightCm),
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">Pack sizes</p>
        {!naming ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-11 sm:h-9"
            disabled={!canSave || create.isPending}
            onClick={startSave}
          >
            <Plus className="size-3.5" aria-hidden />
            Save preset
          </Button>
        ) : null}
      </div>

      {naming && current ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            className="h-11 sm:h-9"
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
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              disabled={create.isPending}
              onClick={submitName}
            >
              Save
            </Button>
            <Button type="button" variant="secondary" size="sm" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {list.isPending ? <p className="text-xs text-muted">Loading pack sizes…</p> : null}
      {list.isError ? (
        <p className="text-xs text-muted">
          {list.error instanceof ApiError ? list.error.message : "Could not load pack sizes."}
        </p>
      ) : null}

      {!list.isPending && !presets.length && !naming ? (
        <p className="text-xs text-muted">Save a pack size to reuse weight and box size.</p>
      ) : null}

      {presets.length ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const pack: PackApply = {
              weightGrams: preset.weightGrams,
              lengthCm: preset.lengthCm,
              widthCm: preset.widthCm,
              heightCm: preset.heightCm,
              serviceCode: preset.serviceCode,
            };
            const selected = preset.id === activeId;
            return (
              <div
                key={preset.id}
                className={cn(
                  "group relative flex max-w-full items-stretch rounded-full border",
                  selected ? "border-brand bg-brand/5" : "border-border bg-surface-soft"
                )}
              >
                <button
                  type="button"
                  className="min-w-0 px-3 py-2 text-left sm:py-1.5"
                  onClick={() => {
                    onApply(pack);
                    touch.mutate(preset.id);
                  }}
                >
                  <span className="block truncate text-xs font-semibold text-ink">{preset.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {Math.round(preset.weightGrams)} g · {trimNum(preset.lengthCm)}×{trimNum(preset.widthCm)}×
                    {trimNum(preset.heightCm)}
                  </span>
                </button>
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:text-error opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  aria-label={`Remove ${preset.name}`}
                  onClick={() => {
                    const ok = window.confirm(`Remove pack size “${preset.name}”?`);
                    if (!ok) return;
                    remove.mutate(preset.id);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
