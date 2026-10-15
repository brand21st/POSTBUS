"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Printer, Usb, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/hooks/use-api";
import { PRINT_STATION_QUERY_KEY } from "@/lib/hooks/use-print-station";
import { useMe } from "@/lib/hooks/use-me";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { hasPermission } from "@/lib/permissions/rbac";
import { automationToggleLock } from "@/modules/billing/entitlements";
import { getWebusbProvider } from "@/modules/print/webusb-provider";
import {
  WEBUSB_TEST_FAILED,
  WEBUSB_TEST_OK,
  WEBUSB_UNAVAILABLE,
  customerPrintError,
} from "@/modules/print/webusb-messages";
import { PAGE_PRESETS, SHEET_PRESETS } from "@/modules/labels/page-presets";
import type { PrintingStatus } from "@/modules/print/provider";
import type { AutomationSettings, PrintingConfiguration, SavedPrinter } from "@/types/api";
import type { MemberRole } from "@/types/domain";
import { cn } from "@/lib/utils";

export const PRINTERS_QUERY_KEY = ["printers"] as const;

const PAPER_PRESETS = [
  ...PAGE_PRESETS,
  ...SHEET_PRESETS.filter((item) => item.id === "A3"),
];

function printerName(printer: SavedPrinter) {
  return printer.displayName || printer.display_name || "USB printer";
}

function isDefaultPrinter(printer: SavedPrinter) {
  return Boolean(printer.isDefault ?? printer.is_default);
}

async function report(printerId: string, path: "presence" | "events", body: Record<string, string>) {
  try {
    await api(`/api/v1/printers/${printerId}/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch {
    // A log failure must not change the printer the customer sees.
  }
}

export function PrintingSettings() {
  const queryClient = useQueryClient();
  const me = useMe();
  const entitlements = usePlanEntitlements();
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "automation.manage");
  const provider = getWebusbProvider();
  const available = provider.isAvailable();
  const [status, setStatus] = useState<PrintingStatus>(provider.getStatus());
  const [busy, setBusy] = useState<string | null>(null);

  const printersQuery = useQuery({
    queryKey: PRINTERS_QUERY_KEY,
    queryFn: () => api<PrintingConfiguration>("/api/v1/printers"),
  });

  useEffect(() => provider.subscribe(() => setStatus(provider.getStatus())), [provider]);

  const printers = printersQuery.data?.printers ?? [];
  const defaultPrinter = printers.find(isDefaultPrinter) ?? null;
  const autoPrint = Boolean(
    printersQuery.data?.autoLabelPrinting ?? printersQuery.data?.auto_label_printing
  );
  const paperSize = printersQuery.data?.paperSize || printersQuery.data?.paper_size || "A6";

  useEffect(() => {
    if (!available) return;
    void provider.syncSaved(defaultPrinter?.deviceKey ?? null).then(() => {
      const next = provider.getStatus();
      if (next.state === "connected" && defaultPrinter && next.deviceKey === defaultPrinter.deviceKey) {
        void report(defaultPrinter.id, "presence", { state: "connected" });
      }
    });
  }, [available, defaultPrinter?.deviceKey, defaultPrinter?.id, provider]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: PRINTERS_QUERY_KEY });
  };

  const savePaper = useMutation({
    mutationFn: (next: string) =>
      api("/api/v1/print-station", {
        method: "PATCH",
        body: JSON.stringify({ paperSize: next }),
      }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: PRINT_STATION_QUERY_KEY });
      toast.success("Paper size saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveAuto = useMutation({
    mutationFn: (enabled: boolean) =>
      api<AutomationSettings>("/api/v1/automation", {
        method: "PATCH",
        body: JSON.stringify({ autoLabelPrinting: enabled }),
      }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["automation"] });
      toast.success("Automatic label printing saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function connect() {
    setBusy("connect");
    try {
      await provider.connect();
      const next = provider.getStatus();
      if (next.state !== "connected" || !next.deviceKey) {
        throw new Error(customerPrintError(new Error(next.message || ""), WEBUSB_UNAVAILABLE));
      }
      const saved = await api<SavedPrinter>("/api/v1/printers", {
        method: "POST",
        body: JSON.stringify({
          displayName: next.deviceName || "USB printer",
          deviceKey: next.deviceKey,
          protocol: "tspl",
        }),
      });
      await report(saved.id, "presence", { state: "connected" });
      await refresh();
      toast.success("Printer connected.");
    } catch (error) {
      toast.error(customerPrintError(error));
    } finally {
      setBusy(null);
    }
  }

  async function testPrint(printer: SavedPrinter) {
    if (status.state !== "connected" || status.deviceKey !== printer.deviceKey) {
      toast.error("The printer is disconnected. Reconnect it and try again.");
      return;
    }
    setBusy(`test:${printer.id}`);
    await report(printer.id, "events", { event: "test_requested" });
    try {
      await provider.testPrint();
      await report(printer.id, "events", { event: "test_succeeded" });
      toast.success(WEBUSB_TEST_OK);
    } catch {
      await report(printer.id, "events", { event: "test_failed" });
      toast.error(WEBUSB_TEST_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(printer: SavedPrinter) {
    setBusy(`disconnect:${printer.id}`);
    try {
      await provider.disconnect();
      await report(printer.id, "presence", { state: "disconnected" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border bg-surface-soft/50 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Printer className="size-4.5" aria-hidden />
          </span>
          <div>
            <CardTitle>Print defaults</CardTitle>
            <CardDescription className="mt-0.5">
              Paper and automation settings for new labels.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        {!available ? (
          <p className="rounded-lg border border-border bg-surface-soft px-3 py-2 text-xs text-muted">{WEBUSB_UNAVAILABLE}</p>
        ) : null}

        {printersQuery.isError ? (
          <p className="rounded-lg bg-red-50 p-2.5 text-xs text-error">Printer settings could not be loaded. Refresh and try again.</p>
        ) : null}

        <section
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors duration-200",
            autoPrint ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
              autoPrint ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-surface-soft text-muted"
            )}>
              <Zap className="size-4" aria-hidden />
            </span>
            <div>
              <Label htmlFor="automatic-label-printing" className="font-semibold">Automatic printing</Label>
              <p className="text-xs text-muted">{autoPrint ? "New labels print when the agent is online." : "New labels stay queued until enabled."}</p>
            </div>
          </div>
          <Switch
            id="automatic-label-printing"
            checked={autoPrint}
            disabled={!canManage || saveAuto.isPending}
            onCheckedChange={(checked) => {
              const feature = automationToggleLock("autoLabelPrinting", entitlements.allows);
              if (feature) {
                toast.error("Automatic printing is not included in the current plan.");
                return;
              }
              saveAuto.mutate(checked);
            }}
          />
        </section>

        <section className="space-y-2 rounded-xl border border-border p-3 transition-colors duration-200 hover:border-brand/25">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="print-paper-size" className="font-semibold">Paper preset</Label>
            {savePaper.isPending ? (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Saving
              </span>
            ) : null}
          </div>
          <Select
            value={paperSize}
            disabled={!canManage || savePaper.isPending}
            onValueChange={(value) => savePaper.mutate(value)}
          >
            <SelectTrigger id="print-paper-size" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted">Applied to shipping labels sent through the Windows agent.</p>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Usb className="size-4 text-muted" aria-hidden />
              <div>
                <h2 className="text-sm font-semibold">Browser USB</h2>
                <p className="text-xs text-muted">Optional direct connection for this browser.</p>
              </div>
            </div>
            {defaultPrinter ? <Badge variant="outline">{printers.length} saved</Badge> : null}
          </div>

          <div className="space-y-2">
          {printers.map((printer) => {
            const live = status.deviceKey === printer.deviceKey ? status.state : "disconnected";
            const connecting = busy === "connect" && live === "connecting";
            const state = live === "connecting" || connecting ? "connecting" : live;
            return (
              <div key={printer.id} className="rounded-xl border border-border p-3 transition-all duration-200 hover:bg-surface-soft/60">
                <div className="flex items-center gap-2.5">
                  <span className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    state === "connected" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-surface-soft text-muted"
                  )}>
                    {state === "connected" ? <CheckCircle2 className="size-4" aria-hidden /> : <Printer className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{printerName(printer)}</p>
                    <p className={cn("text-xs", state === "connected" ? "text-success" : state === "error" ? "text-error" : "text-muted")}>
                      {state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : state === "error" ? "Printer error" : "Disconnected"}
                      {isDefaultPrinter(printer) ? " · Default" : ""}
                    </p>
                  </div>
                </div>
                {state === "error" && status.deviceKey === printer.deviceKey && status.message ? (
                  <p className="mt-1 text-xs text-muted">{status.message}</p>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {!isDefaultPrinter(printer) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={!canManage || busy !== null}
                      onClick={() => {
                        setBusy(`default:${printer.id}`);
                        void api(`/api/v1/printers/${printer.id}`, { method: "PATCH" })
                          .then(async () => {
                            await refresh();
                            toast.success("Default printer saved.");
                          })
                          .catch((error: Error) => toast.error(error.message))
                          .finally(() => setBusy(null));
                      }}
                    >
                      Set as default
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={!canManage || !available || busy !== null || state !== "connected"}
                    onClick={() => void testPrint(printer)}
                  >
                    Test print
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={!available || busy !== null || state !== "connected"}
                    onClick={() => void disconnect(printer)}
                  >
                    Disconnect
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={!canManage || busy !== null}
                    onClick={() => {
                      setBusy(`remove:${printer.id}`);
                      void (async () => {
                        try {
                          if (status.deviceKey === printer.deviceKey) await provider.disconnect();
                          await api(`/api/v1/printers/${printer.id}`, { method: "DELETE" });
                          await refresh();
                          toast.success("Printer removed.");
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Could not remove the printer.");
                        } finally {
                          setBusy(null);
                        }
                      })();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            disabled={!canManage || !available || busy !== null}
            onClick={() => void connect()}
          >
            {busy === "connect" ? <Loader2 className="animate-spin" aria-hidden /> : <Usb aria-hidden />}
            {busy === "connect" ? "Connecting…" : "Connect USB printer"}
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}
