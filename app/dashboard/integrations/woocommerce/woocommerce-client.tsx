"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [showManual, setShowManual] = useState(false);
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
  const returned = params.get("success");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["woocommerce"] });
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const authorize = useMutation({
    mutationFn: (url: string) =>
      api<{ authorizeUrl: string }>("/api/v1/integrations/woocommerce/authorize", {
        method: "POST",
        body: JSON.stringify({ storeUrl: url }),
      }),
    onSuccess: (result) => {
      window.location.href = result.authorizeUrl;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const manual = useMutation({
    mutationFn: (input: { storeUrl: string; consumerKey: string; consumerSecret: string }) =>
      api<WooStatus>("/api/v1/integrations/woocommerce/manual", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setConsumerKey("");
      setConsumerSecret("");
      toast.success("WooCommerce store connected.");
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="WooCommerce"
        description="Import WooCommerce orders and book them with your existing India Post account."
      />
      {returned === "0" ? (
        <p className="text-sm text-red-600">WooCommerce authorization was cancelled. You can try again or enter API keys.</p>
      ) : null}

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
          <p>Webhooks: {(data?.webhookIds?.length ?? 0) > 0 ? "Registered" : "Not registered"}</p>
          {data?.lastError ? <p className="text-red-600">{data.lastError}</p> : null}
          {connected ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>Sync now</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowLogs((value) => !value)}>View sync logs</Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => authorize.mutate(data?.storeUrl || storeUrl)}
                disabled={!data?.storeUrl && !storeUrl}
              >
                Reconnect
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
            <CardDescription>Use WooCommerce authorization, or enter a Read/Write REST API key.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form
              ref={connectFormRef}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const fields = readConnectForm();
                setStoreUrl(fields.storeUrl);
                authorize.mutate(fields.storeUrl);
              }}
              onReset={() => {
                setStoreUrl("");
                setConsumerKey("");
                setConsumerSecret("");
                setShowManual(false);
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="woo-url">Store URL</Label>
                <Input
                  id="woo-url"
                  name="storeUrl"
                  defaultValue=""
                  placeholder="https://shop.example.com"
                  autoComplete="off"
                  onChange={(event) => setStoreUrl(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={authorize.isPending || !storeUrl}>
                  Authorize with WooCommerce
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowManual((value) => !value)}>
                  {showManual ? "Hide manual keys" : "Use API keys instead"}
                </Button>
                <Button
                  type="reset"
                  variant="secondary"
                  onClick={(event) => event.currentTarget.form?.reset()}
                >
                  Reset
                </Button>
              </div>
              {showManual ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="woo-key">Consumer key</Label>
                    <Input
                      id="woo-key"
                      name="consumerKey"
                      defaultValue=""
                      autoComplete="off"
                      onChange={(event) => setConsumerKey(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="woo-secret">Consumer secret</Label>
                    <Input
                      id="woo-secret"
                      name="consumerSecret"
                      type="password"
                      defaultValue=""
                      autoComplete="off"
                      onChange={(event) => setConsumerSecret(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      const fields = readConnectForm();
                      setConsumerKey(fields.consumerKey);
                      setConsumerSecret(fields.consumerSecret);
                      setStoreUrl(fields.storeUrl);
                      manual.mutate(fields);
                    }}
                    disabled={manual.isPending}
                  >
                    Connect with API keys
                  </Button>
                </div>
              ) : null}
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
