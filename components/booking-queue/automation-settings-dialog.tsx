"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { QUEUE_SUMMARY_KEY } from "@/components/booking-queue/view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  AUTO_ENROLL_SOURCES,
  BATCH_THRESHOLD_PRESETS,
  BATCH_THRESHOLD_RANGE,
  MAX_WAIT_PRESETS,
  MAX_WAIT_RANGE,
  type AutoEnrollSource,
  type BookingAutomationSettings,
} from "@/modules/booking-queue/settings-shared";

export const AUTOMATION_SETTINGS_KEY = ["booking-queue-settings"] as const;

const SOURCE_LABELS: Record<AutoEnrollSource, string> = { SHOPIFY: "Shopify", WOOCOMMERCE: "WooCommerce" };

/** "45 min", "2 h", "24 h". Exported for tests. */
export function waitLabel(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

type Draft = {
  mode: "MANUAL" | "AUTOMATIC";
  sources: AutoEnrollSource[];
  thresholdChoice: string;
  customThreshold: string;
  waitChoice: string;
  customWait: string;
  paused: boolean;
};

/** Form state from saved settings. Exported for tests. */
export function draftFromSettings(settings: BookingAutomationSettings): Draft {
  const thresholdPreset = (BATCH_THRESHOLD_PRESETS as readonly number[]).includes(settings.batchThreshold);
  const waitPreset = settings.maxWaitMinutes != null && (MAX_WAIT_PRESETS as readonly number[]).includes(settings.maxWaitMinutes);
  return {
    mode: settings.mode,
    sources: settings.enrollmentSources,
    thresholdChoice: thresholdPreset ? String(settings.batchThreshold) : "custom",
    customThreshold: thresholdPreset ? "" : String(settings.batchThreshold),
    waitChoice: settings.maxWaitMinutes == null ? "none" : waitPreset ? String(settings.maxWaitMinutes) : "custom",
    customWait: waitPreset || settings.maxWaitMinutes == null ? "" : String(settings.maxWaitMinutes),
    paused: settings.paused,
  };
}

/** Request body for PATCH booking-queue/settings. The server validates again. Exported for tests. */
export function settingsBody(draft: Draft, version: number) {
  const batchThreshold = Number(draft.thresholdChoice === "custom" ? draft.customThreshold : draft.thresholdChoice);
  const maxWaitMinutes =
    draft.waitChoice === "none" ? null : Number(draft.waitChoice === "custom" ? draft.customWait : draft.waitChoice);
  return { version, mode: draft.mode, enrollmentSources: draft.sources, batchThreshold, maxWaitMinutes, paused: draft.paused };
}

function SettingsForm({ settings, onSaved }: { settings: BookingAutomationSettings; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFromSettings(settings));
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      api<BookingAutomationSettings>("/api/v1/booking-queue/settings", {
        method: "PATCH",
        body: JSON.stringify(settingsBody(draft, settings.version)),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(AUTOMATION_SETTINGS_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: QUEUE_SUMMARY_KEY });
      toast.success("Bulk Booking settings saved.");
      onSaved();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: AUTOMATION_SETTINGS_KEY });
    },
  });
  const automatic = draft.mode === "AUTOMATIC";

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-ink">Booking mode</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["MANUAL", "AUTOMATIC"] as const).map((mode) => {
            const disabled = mode === "AUTOMATIC" && !settings.automationAvailable;
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                aria-pressed={draft.mode === mode}
                onClick={() => set({ mode, waitChoice: mode === "AUTOMATIC" && draft.waitChoice === "none" ? "30" : draft.waitChoice })}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  draft.mode === mode ? "border-brand bg-rose-50 ring-2 ring-brand/20" : "border-border hover:bg-surface-soft"
                )}
              >
                <span className="font-medium text-ink">{mode === "MANUAL" ? "Manual" : "Automatic"}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {mode === "MANUAL"
                    ? "You approve orders and choose Bulk Booking."
                    : disabled
                      ? "Not available for this workspace yet."
                      : "Valid orders are booked in batches without you."}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">Add orders automatically from</h3>
        <p className="text-xs text-muted">
          Only Prepaid or COD orders join by themselves. {automatic ? "They are booked in the next batch." : "They wait for your approval."}{" "}
          Choosing a source here turns off direct auto-booking for it, so no order is booked twice.
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          {AUTO_ENROLL_SOURCES.map((source) => (
            <label key={source} className="flex items-center gap-2 text-sm text-ink">
              <Checkbox
                checked={draft.sources.includes(source)}
                onCheckedChange={(checked) =>
                  set({
                    sources:
                      checked === true ? [...draft.sources, source] : draft.sources.filter((value) => value !== source),
                  })
                }
              />
              {SOURCE_LABELS[source]}
            </label>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold text-ink">Batch size</span>
          <Select value={draft.thresholdChoice} onValueChange={(value) => set({ thresholdChoice: value })}>
            <SelectTrigger className="mt-1 h-9" aria-label="Batch size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BATCH_THRESHOLD_PRESETS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value.toLocaleString("en-IN")} orders
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {draft.thresholdChoice === "custom" ? (
            <Input
              className="mt-1 h-9"
              type="number"
              inputMode="numeric"
              min={BATCH_THRESHOLD_RANGE.min}
              max={BATCH_THRESHOLD_RANGE.max}
              value={draft.customThreshold}
              onChange={(event) => set({ customThreshold: event.target.value })}
              aria-label="Custom batch size"
            />
          ) : null}
          <span className="mt-1 block text-xs text-muted">Automatic booking starts a batch when this many orders are ready.</span>
        </label>

        <label className="block text-sm">
          <span className="font-semibold text-ink">Maximum wait</span>
          <Select value={draft.waitChoice} onValueChange={(value) => set({ waitChoice: value })}>
            <SelectTrigger className="mt-1 h-9" aria-label="Maximum wait">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {automatic ? null : <SelectItem value="none">No limit</SelectItem>}
              {MAX_WAIT_PRESETS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {waitLabel(value)}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom (minutes)</SelectItem>
            </SelectContent>
          </Select>
          {draft.waitChoice === "custom" ? (
            <Input
              className="mt-1 h-9"
              type="number"
              inputMode="numeric"
              min={MAX_WAIT_RANGE.min}
              max={MAX_WAIT_RANGE.max}
              value={draft.customWait}
              onChange={(event) => set({ customWait: event.target.value })}
              aria-label="Custom maximum wait in minutes"
            />
          ) : null}
          <span className="mt-1 block text-xs text-muted">
            A smaller batch is booked once the oldest ready order has waited this long.
          </span>
        </label>
      </section>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
        <span>
          <span className="block text-sm font-semibold text-ink">Pause automatic booking</span>
          <span className="block text-xs text-muted">Batches already sending finish. New orders still join the queue.</span>
        </span>
        <Switch checked={draft.paused} onCheckedChange={(checked) => set({ paused: checked })} aria-label="Pause automatic booking" />
      </label>

      <p className="text-xs text-muted">
        India Post requests are sent one article at a time until bulk sending is verified with India Post. The batch size
        groups orders; it does not change how many articles go in one request.
      </p>

      <DialogFooter>
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Settings button and dialog for the Bulk Booking dashboard. */
export function AutomationSettingsButton() {
  const [open, setOpen] = useState(false);
  const settings = useQuery({
    queryKey: AUTOMATION_SETTINGS_KEY,
    enabled: open,
    queryFn: () => api<BookingAutomationSettings>("/api/v1/booking-queue/settings"),
  });
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" />
        Settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Booking settings</DialogTitle>
            <DialogDescription>How orders join the queue and when they are booked.</DialogDescription>
          </DialogHeader>
          {settings.data ? (
            <SettingsForm key={settings.data.version} settings={settings.data} onSaved={() => setOpen(false)} />
          ) : settings.isError ? (
            <p className="text-sm text-red-700">{(settings.error as Error).message}</p>
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
