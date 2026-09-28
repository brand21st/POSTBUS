"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";
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
import type { PrintingStatus } from "@/modules/print/provider";
import type { AutomationSettings, PrintingConfiguration, SavedPrinter } from "@/types/api";
import type { MemberRole } from "@/types/domain";
import { cn } from "@/lib/utils";

export const PRINTERS_QUERY_KEY = ["printers"] as const;

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
  const labelSize = printersQuery.data?.labelSizeLabel || printersQuery.data?.label_size_label || "105 × 148 mm (A6)";

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
    <Card>
      <CardHeader>
        <CardTitle>Printing</CardTitle>
        <CardDescription>Connect a USB label printer in this browser. The saved default stays with your workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!available ? (
          <p className="rounded-xl border border-border bg-surface-soft px-3 py-2 text-sm text-muted">{WEBUSB_UNAVAILABLE}</p>
        ) : null}

        {printersQuery.isError ? (
          <p className="text-sm text-error">Printer settings could not be loaded. Refresh and try again.</p>
        ) : null}

        <div className="space-y-3">
          {printers.map((printer) => {
            const live = status.deviceKey === printer.deviceKey ? status.state : "disconnected";
            const connecting = busy === "connect" && live === "connecting";
            const state = live === "connecting" || connecting ? "connecting" : live;
            return (
              <div key={printer.id} className="rounded-xl border border-border p-4">
                <div className="flex items-center gap-2">
                  <Printer
                    className={cn("size-4", state === "connected" && "animate-pulse-soft text-success")}
                    aria-hidden
                  />
                  <p className="font-medium text-foreground">{printerName(printer)}</p>
                </div>
                <p
                  className={cn(
                    "mt-2 text-sm",
                    state === "connected" && "text-success",
                    state === "error" && "text-error",
                    state !== "connected" && state !== "error" && "text-muted"
                  )}
                >
                  {state === "connected"
                    ? "Connected"
                    : state === "connecting"
                      ? "Connecting..."
                      : state === "error"
                        ? "Printer error"
                        : "Disconnected"}
                </p>
                {state === "error" && status.deviceKey === printer.deviceKey && status.message ? (
                  <p className="mt-1 text-xs text-muted">{status.message}</p>
                ) : null}
                {isDefaultPrinter(printer) ? <p className="mt-3 text-sm text-foreground">Default printer</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!isDefaultPrinter(printer) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
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
                    variant="secondary"
                    size="sm"
                    disabled={!canManage || !available || busy !== null || state !== "connected"}
                    onClick={() => void testPrint(printer)}
                  >
                    Test print
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!available || busy !== null || state !== "connected"}
                    onClick={() => void disconnect(printer)}
                  >
                    Disconnect
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
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

        <Button type="button" variant="secondary" disabled={!canManage || !available || busy !== null} onClick={() => void connect()}>
          <Printer className="size-4" />
          Connect USB printer
        </Button>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
          <div>
            <Label>Automatic label printing</Label>
            <p className="text-xs text-muted">Print the India Post label after it is generated.</p>
          </div>
          <Switch
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
        </div>

        <div className="rounded-xl border border-border px-3 py-2 text-sm">
          <p className="text-muted">Label size</p>
          <p className="font-medium text-foreground">{labelSize}</p>
          <p className="mt-1 text-xs text-muted">The India Post PDF is printed at its own page size and is not resized.</p>
        </div>
      </CardContent>
    </Card>
  );
}
