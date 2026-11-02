"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MonitorCog, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { PRINT_STATION_QUERY_KEY, usePrintStation } from "@/lib/hooks/use-print-station";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/types/domain";

type PrintDevice = {
  id: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  agentVersion: string;
  lastSeenAt: string | null;
  connection: "online" | "offline";
  authorization: "active" | "revoked";
};

type PairingPreview = {
  deviceName: string;
  platform: string;
  osVersion: string;
  agentVersion: string;
  organizationName: string | null;
};

const DEVICES_KEY = ["print-devices"] as const;

function lastSeen(value: string | null) {
  if (!value) return "Never connected";
  return `Last seen ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))}`;
}

export function PrintAgentDevices() {
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "automation.manage");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<PairingPreview | null>(null);
  const devices = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => api<PrintDevice[]>("/api/v1/print-devices"),
  });
  const station = usePrintStation();
  const selectedDeviceId = station.data?.selectedDeviceId ?? station.data?.selected_device_id ?? null;
  const stationDevices = station.data?.devices ?? [];

  const connect = useMutation({
    mutationFn: () =>
      api<PairingPreview>("/api/v1/print-devices/pair/approve", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    onSuccess: async (result) => {
      setPreview(result);
      setCode("");
      await queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
      toast.success("Pairing confirmed. The Windows app will finish connecting.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectStation = useMutation({
    mutationFn: (deviceId: string) => {
      const printers = stationDevices.find((row) => row.id === deviceId)?.printers ?? [];
      const current = station.data?.selectedPrinterName ?? station.data?.selected_printer_name ?? null;
      return api("/api/v1/print-station", {
        method: "PATCH",
        body: JSON.stringify({
          selectedDeviceId: deviceId,
          selectedPrinterName: current && printers.includes(current) ? current : printers[0] ?? null,
        }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PRINT_STATION_QUERY_KEY });
      toast.success("Print jobs will go to this computer.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/print-devices/${id}/revoke`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
      toast.success("Device disconnected.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = devices.data ?? [];
  const activeCount = rows.filter((device) => device.authorization === "active").length;
  const onlineCount = rows.filter(
    (device) => device.authorization === "active" && device.connection === "online"
  ).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border bg-surface-soft/50 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <MonitorCog className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <CardTitle>Windows Print Agent</CardTitle>
              <CardDescription className="mt-0.5">
                Pair a trusted packing computer for automatic printing.
              </CardDescription>
            </div>
          </div>
          <Badge variant={onlineCount > 0 ? "success" : "outline"} className="shrink-0">
            {onlineCount > 0 ? `${onlineCount} online` : `${activeCount} paired`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <section className="rounded-xl border border-border bg-card p-3.5 transition-colors duration-200 hover:border-brand/25">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="pairing-code" className="text-sm font-semibold">Pair a new computer</Label>
              <p className="mt-0.5 text-xs text-muted">Enter the 8-character code shown in the Windows app.</p>
            </div>
            <ShieldCheck className="size-4 shrink-0 text-muted" aria-hidden />
          </div>
          <div className="flex gap-2">
            <Input
              id="pairing-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 9))}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 font-mono tracking-[0.18em]"
              disabled={!canManage}
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={!canManage || code.trim().length < 8 || connect.isPending}
              onClick={() => connect.mutate()}
            >
              {connect.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Pair
            </Button>
          </div>
          {preview ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-transparent bg-emerald-100 p-2.5 text-xs text-emerald-800 animate-in fade-in slide-in-from-top-1 duration-200">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-800" aria-hidden />
              <p className="text-emerald-800">
                <span className="font-semibold">{preview.deviceName}</span> paired with{" "}
                {preview.organizationName || me.data?.organization?.name || "your organization"}.
              </p>
            </div>
          ) : null}
        </section>
        <section>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Computers</h2>
              <p className="text-xs text-muted">{activeCount} active device{activeCount === 1 ? "" : "s"}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={devices.isFetching}
              onClick={() => void devices.refetch()}
            >
              <RefreshCw className={devices.isFetching ? "animate-spin" : ""} aria-hidden />
              Refresh
            </Button>
          </div>
          {devices.isError ? (
            <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-error">Device pairing is unavailable. Refresh and try again.</p>
          ) : null}
          {!devices.isError && rows.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
              No Windows computers paired yet.
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            {rows.map((device) => (
              <div
                key={device.id}
                className="group flex items-center gap-3 rounded-xl border border-border p-3 transition-all duration-200 hover:border-zinc-300 hover:bg-surface-soft/60 dark:hover:border-zinc-700"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    device.authorization === "active" && device.connection === "online"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-surface-soft text-muted"
                  )}
                >
                  {device.authorization === "active" && device.connection === "online"
                    ? <Wifi className="size-4" aria-hidden />
                    : <WifiOff className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{device.deviceName}</p>
                    <Badge
                      variant={
                        device.authorization === "revoked"
                          ? "error"
                          : device.connection === "online"
                            ? "success"
                            : "outline"
                      }
                      className="px-2 py-0 text-[10px]"
                    >
                      {device.authorization === "revoked" ? "Revoked" : device.connection === "online" ? "Online" : "Offline"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {device.platform} {device.osVersion} · v{device.agentVersion || "unknown"} · {lastSeen(device.lastSeenAt)}
                  </p>
                </div>
                {canManage && device.authorization === "active" ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant={selectedDeviceId === device.id ? "secondary" : "ghost"}
                      size="xs"
                      disabled={selectStation.isPending}
                      onClick={() => selectStation.mutate(device.id)}
                    >
                      {selectedDeviceId === device.id ? "Selected station" : "Use for printing"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted opacity-70 transition-opacity group-hover:opacity-100"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(device.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <p className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          Pair only trusted packing computers. Access can be revoked at any time.
        </p>
      </CardContent>
    </Card>
  );
}
