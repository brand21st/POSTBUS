"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { WooCommerceLogo } from "@/components/brand/woocommerce-logo";
import { WooCommerceWatchTutorialLink } from "@/components/integrations/woocommerce-watch-tutorial-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
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
  syncJobStatus?: string | null;
  syncJobError?: string | null;
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

const ORDER_STATUSES = [
  { value: "processing", label: "Processing", hint: "Paid or being packed" },
  { value: "on-hold", label: "On hold", hint: "Waiting for payment or review" },
  { value: "pending", label: "Pending", hint: "Checkout started, not paid" },
  { value: "completed", label: "Completed", hint: "Already marked complete in WooCommerce" },
] as const;

function jobHelp(status?: string | null, error?: string | null) {
  const code = (status ?? "").toUpperCase();
  if (code === "QUEUED" || code === "RUNNING" || code === "PROCESSING") {
    return {
      tone: "info" as const,
      title: "Importing orders",
      body: "PostBus is pulling orders in the background. They appear on the Orders page as each batch finishes. This can take a few minutes for a large store.",
    };
  }
  if (code === "FAILED") {
    return {
      tone: "error" as const,
      title: "Last import did not finish",
      body: error || "Try Import orders now. If it fails again, use Test connection.",
    };
  }
  if (code === "SUCCEEDED") {
    return {
      tone: "ok" as const,
      title: "Last import finished",
      body: "New orders continue to arrive when auto import is on, or when the store sends an update.",
    };
  }
  return null;
}

function topicLabel(topic: string) {
  const key = topic.toLowerCase();
  if (key.includes("created")) return "New order";
  if (key.includes("updated")) return "Order updated";
  if (key.includes("deleted")) return "Order deleted";
  return topic;
}

export default function WooCommerceIntegration() {
  const queryClient = useQueryClient();
  const [showLogs, setShowLogs] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
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
  const job = jobHelp(data?.syncJobStatus, data?.syncJobError);
  const settings = data?.settings;
  const selectedStatuses = settings?.eligibleStatuses ?? ["processing", "on-hold"];

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
      toast.success(result.storeHost ? `Store reached: ${result.storeHost}` : "Store connection looks good.");
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
      toast.success("Store connected. Orders will start importing.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const webhooks = useMutation({
    mutationFn: () => api<WooStatus>("/api/v1/integrations/woocommerce/webhooks", { method: "POST" }),
    onSuccess: () => {
      toast.success("Instant updates from the store are set.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: () => api("/api/v1/integrations/woocommerce/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Import started. Orders will appear on the Orders page shortly.");
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
      setConfirmDisconnect(false);
      toast.success("Store disconnected. Imported orders are still in PostBus.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="WooCommerce"
        description="Pull store orders into PostBus, then book them with India Post."
        actions={connected ? <StatusBadge value={data?.status ?? "CONNECTED"} /> : undefined}
      />

      <WooCommerceWatchTutorialLink />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle>
              <WooCommerceLogo className="h-6" />
            </CardTitle>
            {!connected ? <StatusBadge value={data?.status ?? "NOT_CONNECTED"} /> : null}
          </div>
          <CardDescription>
            {connected
              ? "This workspace is linked to your WooCommerce store. Imported orders stay in PostBus even if you disconnect later."
              : "Connect with a Read/Write REST API key. PostBus does not install a WordPress plugin."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Store" value={data?.storeHost || "—"} />
                <Stat
                  label="Orders in PostBus"
                  value={formatNumber(data?.ordersImported ?? 0)}
                  hint={
                    <Link href="/dashboard/orders" className="font-medium text-brand hover:underline">
                      Open Orders
                    </Link>
                  }
                />
                <Stat
                  label="Last finished import"
                  value={formatRelative(data?.lastSuccessfulSyncAt)}
                  hint={data?.lastSuccessfulSyncAt ? formatDate(data.lastSuccessfulSyncAt, true) : "No completed import yet"}
                />
                <Stat
                  label="Instant updates"
                  value={webhookCount >= 3 ? "On" : webhookCount > 0 ? "Partial" : "Off"}
                  hint={
                    data?.lastWebhookAt
                      ? `Last store event ${formatRelative(data.lastWebhookAt)}`
                      : "New checkout orders arrive here when WooCommerce can reach PostBus"
                  }
                />
              </dl>

              {job ? (
                <p
                  className={
                    job.tone === "error"
                      ? "rounded-2xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error"
                      : "rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-ink"
                  }
                >
                  <span className="font-medium">{job.title}. </span>
                  <span className={job.tone === "error" ? undefined : "text-muted"}>{job.body}</span>
                </p>
              ) : null}

              {data?.lastError ? (
                <p className="rounded-2xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">{data.lastError}</p>
              ) : null}

              {webhookCount < 3 ? (
                <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                  Instant updates are not fully set. Use <span className="text-ink">Set up instant updates</span> so new
                  checkouts reach PostBus without waiting for a full import.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
                  {test.isPending ? "Testing…" : "Test connection"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => webhooks.mutate()} disabled={webhooks.isPending}>
                  {webhooks.isPending
                    ? "Saving…"
                    : webhookCount > 0
                      ? "Refresh instant updates"
                      : "Set up instant updates"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? "Starting…" : "Import orders now"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowLogs((value) => !value)}>
                  {showLogs ? "Hide store events" : "View store events"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmDisconnect(true)} disabled={disconnect.isPending}>
                  Disconnect store
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No store connected yet. Add API keys below.</p>
          )}
        </CardContent>
      </Card>

      {!connected ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect your store</CardTitle>
            <CardDescription>
              In WordPress go to WooCommerce → Settings → Advanced → REST API, add a key with Read/Write, then paste it
              here.{" "}
              <a
                href="https://woocommerce.com/document/woocommerce-rest-api/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand hover:underline"
              >
                How to create a key
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="mb-5 list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Paste the public store URL (https).</li>
              <li>Test connection to confirm PostBus can reach the store.</li>
              <li>Connect store to save the key and start importing orders.</li>
            </ol>
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
                  placeholder="https://yourstore.com"
                  autoComplete="off"
                />
                <p className="text-xs text-muted">The website customers use. Must start with https://</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-key">Consumer key</Label>
                <Input id="woo-key" name="consumerKey" placeholder="ck_…" defaultValue="" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woo-secret">Consumer secret</Label>
                <Input
                  id="woo-secret"
                  name="consumerSecret"
                  type="password"
                  placeholder="cs_…"
                  defaultValue=""
                  autoComplete="off"
                />
                <p className="text-xs text-muted">Stored encrypted. PostBus never shows it again after you connect.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => test.mutate(readConnectForm())}
                  disabled={test.isPending}
                >
                  {test.isPending ? "Testing…" : "Test connection"}
                </Button>
                <Button type="submit" disabled={connect.isPending}>
                  {connect.isPending ? "Connecting…" : "Connect store"}
                </Button>
                <Button type="reset" variant="secondary">
                  Clear
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Import and tracking</CardTitle>
            <CardDescription>
              Booking still happens in Orders. Auto booking stays off unless you turn it on in Automation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SettingRow
              id="woo-auto-import"
              title="Auto import"
              description="Keep pulling new and updated WooCommerce orders into PostBus."
              checked={data?.syncEnabled !== false}
              disabled={save.isPending}
              onCheckedChange={(value) => save.mutate({ syncEnabled: value, autoSync: value })}
            />

            <div className="space-y-2">
              <Label htmlFor="woo-import-window">First import window</Label>
              <select
                id="woo-import-window"
                className="h-10 w-full max-w-xs rounded-md border border-border bg-card px-3 text-sm"
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
              <p className="text-xs text-muted">Used when catching up. After that, auto import and store events keep the list current.</p>
            </div>

            <div className="space-y-2">
              <Label>Which WooCommerce statuses to import</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {ORDER_STATUSES.map((item) => (
                  <label
                    key={item.value}
                    className="flex items-start gap-3 rounded-2xl border border-border bg-card px-3 py-2.5"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedStatuses.includes(item.value)}
                      disabled={save.isPending}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...selectedStatuses, item.value]
                          : selectedStatuses.filter((statusName) => statusName !== item.value);
                        save.mutate({ eligibleStatuses: next });
                      }}
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">{item.label}</span>
                      <span className="block text-xs text-muted">{item.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted">
                Set item or box weight on each order before India Post booking. Missing weight is normal on first import.
              </p>
            </div>

            <SettingRow
              id="woo-awb"
              title="Send AWB to WooCommerce"
              description="After a successful India Post booking, write the tracking number back to the WooCommerce order."
              checked={data?.autoTracking === true}
              disabled={save.isPending}
              onCheckedChange={(value) => save.mutate({ autoTracking: value })}
            />
            <SettingRow
              id="woo-note"
              title="Add a customer tracking note"
              description="Leave a note on the WooCommerce order so the buyer can see the AWB."
              checked={settings?.addTrackingNote === true}
              disabled={save.isPending}
              onCheckedChange={(value) => save.mutate({ addTrackingNote: value })}
            />
            <SettingRow
              id="woo-status"
              title="Update WooCommerce status after dispatch"
              description="Scan updates can change the WooCommerce order status using your mapping. Creating an AWB does not mark the order completed."
              checked={settings?.updateOrderStatus === true}
              disabled={save.isPending}
              onCheckedChange={(value) => save.mutate({ updateOrderStatus: value })}
            />

            {job?.tone === "error" ? (
              <Button variant="secondary" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Starting…" : "Retry import"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      {showLogs ? (
        <Card>
          <CardHeader>
            <CardTitle>Store events</CardTitle>
            <CardDescription>
              Instant notices from WooCommerce when an order is created, updated, or deleted. Keys are never stored here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(logs.data?.deliveries ?? []).length === 0 ? (
              <p className="text-muted">
                No store events yet. That is normal on a first connect. Use Import orders now, or place a test order in
                WooCommerce after instant updates are on.
              </p>
            ) : (
              (logs.data?.deliveries ?? []).map((row) => (
                <p key={row.id} className="rounded-xl border border-border px-3 py-2">
                  <span className="font-medium text-ink">{topicLabel(row.topic)}</span>
                  <span className="text-muted">
                    {" "}
                    · {row.status}
                    {row.last_error ? ` · ${row.last_error}` : ""} · {formatDate(row.created_at, true)}
                  </span>
                </p>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect this WooCommerce store?</DialogTitle>
            <DialogDescription>
              PostBus will stop importing new orders and remove the saved API key. Orders already in PostBus stay here
              and can still be booked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmDisconnect(false)}>
              Keep connected
            </Button>
            <Button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              {disconnect.isPending ? "Disconnecting…" : "Disconnect store"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function SettingRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium text-ink">
          {title}
        </Label>
        <p className="mt-1 text-xs text-muted">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}
