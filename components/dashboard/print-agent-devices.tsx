"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
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

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/print-devices/${id}/revoke`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
      toast.success("Device disconnected.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = devices.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>PostBus Print Agent</CardTitle>
        <CardDescription>Connect a Windows computer to this organization. This step does not print shipping labels.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Download</h2>
          <p className="text-sm text-muted">PostBus Print Agent for Windows. Use the installer built for your organization. A public download is not published from this screen.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Connect a device</h2>
          <Label htmlFor="pairing-code">Pairing code</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="pairing-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="max-w-48"
              disabled={!canManage}
            />
            <Button type="button" disabled={!canManage || code.trim().length < 8 || connect.isPending} onClick={() => connect.mutate()}>
              Connect device
            </Button>
          </div>
          {preview ? (
            <div className="rounded-xl border border-border p-3 text-sm">
              <p>Device: {preview.deviceName}</p>
              <p>System: {preview.platform} {preview.osVersion}</p>
              <p>Access requested: connect this computer to {preview.organizationName || me.data?.organization?.name || "your organization"}.</p>
            </div>
          ) : null}
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Connected devices</h2>
            <Button type="button" variant="secondary" onClick={() => void devices.refetch()}>Refresh</Button>
          </div>
          {devices.isError ? <p className="text-sm text-error">Device pairing is not available on this server yet.</p> : null}
          {!devices.isError && rows.length === 0 ? <p className="text-sm text-muted">No Windows print agents are connected.</p> : null}
          <div className="space-y-2">
            {rows.map((device) => (
              <div key={device.id} className="grid gap-2 rounded-xl border border-border p-3 text-sm md:grid-cols-[1.4fr_1fr_auto] md:items-center">
                <div>
                  <p className="font-medium">{device.deviceName}</p>
                  <p className="text-muted">{device.platform} {device.osVersion} · agent {device.agentVersion || "unknown"}</p>
                </div>
                <p>
                  {device.authorization === "revoked" ? "Revoked" : device.connection === "online" ? "Online" : "Offline"}
                  {device.lastSeenAt ? ` · last seen ${new Date(device.lastSeenAt).toLocaleString()}` : ""}
                </p>
                {canManage && device.authorization === "active" ? (
                  <Button type="button" variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate(device.id)}>
                    Revoke access
                  </Button>
                ) : <span />}
              </div>
            ))}
          </div>
        </section>
        <p className="text-sm text-muted">Only connect computers you trust. A paired device will eventually be able to receive shipping labels for this organization. It cannot do that in this version.</p>
      </CardContent>
    </Card>
  );
}
