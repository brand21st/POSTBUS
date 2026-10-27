"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { WooCommerceLogo } from "@/components/brand/woocommerce-logo";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";

type WooStatus = {
  status?: string;
  storeUrl?: string;
  storeHost?: string;
  syncEnabled?: boolean;
  autoSync?: boolean;
  autoTracking?: boolean;
  lastSyncAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  lastWebhookAt?: string | null;
  lastError?: string | null;
  ordersImported?: number;
  hasCredentials?: boolean;
  webhookIds?: number[];
  settings?: {
    eligibleStatuses?: string[];
    importDays?: number;
    customAfter?: string | null;
    customBefore?: string | null;
    addTrackingNote?: boolean;
    updateOrderStatus?: boolean;
  };
};

type Delivery = {
  id: string;
  topic: string;
  status: string;
  last_error?: string | null;
  created_at?: string;
};

const STATUSES = ["processing", "on-hold", "pending", "completed"];

export default function WooCommerceIntegration() {
  const queryClient = useQueryClient();
  const [showLogs, setShowLogs] = useState(false);
  const connectFormRef = useRef<HTMLFormElement>(null);
  const status = useQuery({
    queryKey: ["woocommerce"],
    queryFn: () => api<WooStatus>("/api/v1/integrations/woocommerce"),
  });
  const logs = useQuery({
    queryKey: ["woocommerce-deliveries"],
    enabled: showLogs,
    queryFn: () => api<{ deliveries: Delivery[] }>("/api/v1/integrations/woocommerce/deliveries"),
  });
  const data = status.data;
  const connected = (data?.status ?? "").toUpperCase() === "CONNECTED";
  const webhookCount = data?.webhookIds?.length ?? 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["woocommerce"] });
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const readConnectForm = () => {
    const form = connectFormRef.current;
    if (!form) return { storeUrl: "", consumerKey: "", consumerSecret: "" };
    const fields = new FormData(form);
    return {
      storeUrl: String(fields.get("storeUrl") ?? "").trim(),
      consumerKey: String(fields.get("consumerKey") ?? "").trim(),
      consumerSecret: String(fields.get("consumerSecret") ?? "").trim(),
    };
  };

  const test = useMutation({
    mutationFn: (input?: { storeUrl: string; consumerKey: string; consumerSecret: string }) =>
      api<{ ok: boolean; storeHost?: string }>("/api/v1/integrations/woocommerce/test", {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: (result) => {
      toast.success(result.storeHost ? `REST API reached ${result.storeHost}.` : "REST API connection succeeded.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const connect = useMutation({
    mutationFn: (input: { storeUrl: string; consumerKey: string; consumerSecret: string }) =>
      api<WooStatus>("/api/v1/integrations/woocommerce/manual", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      connectFormRef.current?.reset();
      toast.success("WooCommerce store connected.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const webhooks = useMutation({
    mutationFn: () => api<WooStatus>("/api/v1/integrations/woocommerce/webhooks", { method: "POST" }),
    onSuccess: () => {
      toast.success("Order webhooks registered.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: () => api("/api/v1/integrations/woocommerce/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Sync queued.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/v1/integrations/woocommerce", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Settings saved.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnect = useMutation({
    mutationFn: () => api("/api/v1/integrations/woocommerce", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Store disconnected. Imported orders were kept.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const settings = data?.settings;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WooCommerce"
        description="Import WooCommerce orders and book them with your existing India Post account."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <WooCommerceLogo className="h-6" />
          </CardTitle>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-muted">
            <span>Connection status:</span>
            <StatusBadge value={data?.status ?? "NOT_CONNECTED"} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Store: {data?.storeHost || "Not connected"}</p>
          <p>Last sync: {formatDate(data?.lastSyncAt, true)}</p>
          <p>Last successful sync: {formatDate(data?.lastSuccessfulSyncAt, true)}</p>
          <p>Orders imported: {(data?.ordersImported ?? 0).toLocaleString("en-IN")}</p>
          <p>Auto sync: {data?.autoSync === false ? "Disabled" : "Enabled"}</p>
          <p>
            Webhooks:{" "}
            {webhookCount > 0
              ? `${webhookCount} registered (order created, updated, deleted)`
              : "Not registered"}
          </p>
          {data?.lastWebhookAt ? <p>Last webhook: {formatDate(data.lastWebhookAt, true)}</p> : null}
          {data?.lastError ? <p className="text-red-600">{data.lastError}</p> : null}
          {connected ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
                Test connection
              </Button>
              <Button size="sm" variant="secondary" onClick={() => webhooks.mutate()} disabled={webhooks.isPending}>
                {webhookCount > 0 ? "Re-register webhooks" : "Register webhooks"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                Sync now
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowLogs((value) => !value)}>
                View sync logs
              </Button>
              <Button size="sm" variant="secondary" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                Disconnect
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!connected ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect a store</CardTitle>
            <CardDescription>
              Use a Read/Write REST API key from WooCommerce → Settings → Advanced → REST API. PostBus will
              verify the key, then register order webhooks.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form
              ref={connectFormRef}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                connect.mutate(readConnectForm());
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="woo-url">Store URL</Label>
                <Input
                  id="woo-url"
                  name="storeUrl"
                  defaultValue={data?.storeUrl || ""}
                  placeholder="https://shop.example.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-key">Consumer key</Label>
                <Input id="woo-key" name="consumerKey" defaultValue="" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-secret">Consumer secret</Label>
                <Input
                  id="woo-secret"
                  name="consumerSecret"
                  type="password"
                  defaultValue=""
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => test.mutate(readConnectForm())}
                  disabled={test.isPending}
                >
                  Test connection
                </Button>
                <Button type="submit" disabled={connect.isPending}>
                  Connect store
                </Button>
                <Button type="reset" variant="secondary">
                  Reset
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Integration settings</CardTitle>
            <CardDescription>Automatic booking stays off unless Auto booking is enabled in Automation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data?.syncEnabled !== false}
                onChange={(event) => save.mutate({ syncEnabled: event.target.checked, autoSync: event.target.checked })}
              />
              Auto sync
            </label>
            <div className="space-y-2">
              <Label>Initial import window</Label>
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={settings?.customAfter ? "custom" : String(settings?.importDays ?? 30)}
                onChange={(event) => {
                  if (event.target.value === "custom") return;
                  save.mutate({ importDays: Number(event.target.value), customAfter: null, customBefore: null });
                }}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Eligible order statuses</Label>
              <div className="flex flex-wrap gap-3">
                {STATUSES.map((statusName) => {
                  const selected = settings?.eligibleStatuses ?? ["processing", "on-hold"];
                  return (
                    <label key={statusName} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(statusName)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...selected, statusName]
                            : selected.filter((item) => item !== statusName);
                          save.mutate({ eligibleStatuses: next });
                        }}
                      />
                      {statusName}
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data?.autoTracking === true}
                onChange={(event) => save.mutate({ autoTracking: event.target.checked })}
              />
              Sync AWB to WooCommerce
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings?.addTrackingNote === true}
                onChange={(event) => save.mutate({ addTrackingNote: event.target.checked })}
              />
              Add a customer tracking note
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings?.updateOrderStatus === true}
                onChange={(event) => save.mutate({ updateOrderStatus: event.target.checked })}
              />
              Update WooCommerce order status from shipment scans
            </label>
            <p className="text-muted">
              An AWB does not mark the WooCommerce order completed. Status changes use the mapping you save, and only after dispatch.
            </p>
            <Button variant="secondary" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
              Retry failed sync
            </Button>
          </CardContent>
        </Card>
      )}

      {showLogs ? (
        <Card>
          <CardHeader>
            <CardTitle>Sync logs</CardTitle>
            <CardDescription>Recent webhook deliveries. Secrets are not stored in these rows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(logs.data?.deliveries ?? []).length === 0 ? <p>No webhook deliveries yet.</p> : null}
            {(logs.data?.deliveries ?? []).map((row) => (
              <p key={row.id}>
                {row.topic} · {row.status}
                {row.last_error ? ` · ${row.last_error}` : ""} · {formatDate(row.created_at, true)}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
