"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";

type RazorpaySettings = {
  connected: boolean;
  keyId: string;
  keyIdMasked: string;
  keySecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookConfigured: boolean;
  webhookId: string | null;
  webhookUrl: string;
  webhookEvents: string[];
  mode: "live" | "test";
  source: string;
};

const VACHAT_LIVE_EVENTS = [
  "order_confirmation",
  "processing",
  "booked",
  "in_transit",
  "delivered",
] as const;

type VachatEventKey = (typeof VACHAT_LIVE_EVENTS)[number];

type VachatSettings = {
  enabled: boolean;
  connected: boolean;
  status: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  keyMasked: string;
  webhookSecretConfigured: boolean;
  webhookEndpointId: string | null;
  webhookUrl: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
    lastTestPhone: string | null;
    eventSettings: Record<VachatEventKey, boolean>;
    source: string;
    templateSyncError?: string | null;
  identity?: {
    display_phone: string | null;
    verified_name: string | null;
    account_id: string | null;
  };
    templates?: {
      order_confirmation_template_name?: string | null;
      processing_template_name?: string | null;
      booked_template_name?: string | null;
      in_transit_template_name?: string | null;
      delivered_template_name?: string | null;
      approved_templates?: Array<{ name: string; language: string }>;
    } | null;
    templatesLoadError?: string | null;
};

type VachatStats = {
  today: Record<string, number>;
  last7d: Record<string, number>;
  last30d: Record<string, number>;
};

type VachatLogRow = {
  id: string;
  organization_id: string;
  event: string;
  phone: string | null;
  external_ref: string;
  status: string;
  error: string | null;
  created_at: string;
};

export default function AdminSettingsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "settings", "razorpay"],
    queryFn: () => api<RazorpaySettings>("/api/admin/settings/razorpay"),
  });
  const vachatQuery = useQuery({
    queryKey: ["admin", "settings", "vachat"],
    queryFn: () => api<VachatSettings>("/api/admin/settings/vachat"),
  });
  const vachatStatsQuery = useQuery({
    queryKey: ["admin", "settings", "vachat", "stats"],
    queryFn: () => api<VachatStats>("/api/admin/settings/vachat/stats"),
  });
  const vachatLogsQuery = useQuery({
    queryKey: ["admin", "settings", "vachat", "logs"],
    queryFn: () => api<VachatLogRow[]>("/api/admin/settings/vachat/logs?limit=40"),
  });
  const data = query.data;
  const vachat = vachatQuery.data;
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [vachatKey, setVachatKey] = useState("");
  const [vachatUrl, setVachatUrl] = useState("");
  const [vachatEnabled, setVachatEnabled] = useState<boolean | null>(null);
  const [vachatTestPhone, setVachatTestPhone] = useState("");
  const [eventDraft, setEventDraft] = useState<Partial<Record<VachatEventKey, boolean>>>({});
  const [templateDraft, setTemplateDraft] = useState<Partial<Record<string, string>>>({});
  const resolvedKeyId = keyId || data?.keyId || "";
  const resolvedVachatUrl = vachatUrl || vachat?.apiBaseUrl || "https://cloud.vachat.in";
  const resolvedVachatEnabled = vachatEnabled ?? vachat?.enabled ?? false;
  const resolvedTestPhone = vachatTestPhone || vachat?.lastTestPhone || "";
  const templateCol: Record<VachatEventKey, string> = {
    order_confirmation: "order_confirmation_template_name",
    processing: "processing_template_name",
    booked: "booked_template_name",
    in_transit: "in_transit_template_name",
    delivered: "delivered_template_name",
  };

  const save = useMutation({
    mutationFn: () =>
      api<RazorpaySettings>("/api/admin/settings/razorpay", {
        method: "PATCH",
        body: JSON.stringify({
          keyId: resolvedKeyId,
          keySecret: keySecret || undefined,
          webhookSecret: webhookSecret || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Razorpay credentials saved.");
      setKeySecret("");
      setWebhookSecret("");
      client.invalidateQueries({ queryKey: ["admin", "settings", "razorpay"] });
      client.invalidateQueries({ queryKey: ["admin", "razorpay"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testApi = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; mode: string; customerCount: number }>("/api/admin/settings/razorpay/test", {
        method: "POST",
        body: JSON.stringify({
          keyId: resolvedKeyId || undefined,
          keySecret: keySecret || undefined,
        }),
      }),
    onSuccess: (result) => {
      toast.success(`Razorpay ${result.mode} API OK (${result.customerCount} customer sample).`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const registerWebhook = useMutation({
    mutationFn: () =>
      api<RazorpaySettings>("/api/admin/settings/razorpay/webhook", {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Razorpay billing webhook registered.");
      client.invalidateQueries({ queryKey: ["admin", "settings", "razorpay"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveVachat = useMutation({
    mutationFn: () =>
      api<VachatSettings>("/api/admin/settings/vachat", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: resolvedVachatEnabled,
          apiBaseUrl: resolvedVachatUrl,
          apiKey: vachatKey || undefined,
          eventSettings: {
            order_confirmation: eventDraft.order_confirmation ?? vachat?.eventSettings?.order_confirmation ?? false,
            processing: eventDraft.processing ?? vachat?.eventSettings?.processing ?? false,
            booked: eventDraft.booked ?? vachat?.eventSettings?.booked ?? false,
            in_transit: eventDraft.in_transit ?? vachat?.eventSettings?.in_transit ?? false,
            delivered: eventDraft.delivered ?? vachat?.eventSettings?.delivered ?? false,
          },
          templates: {
            order_confirmation_template_name:
              templateDraft.order_confirmation_template_name ??
              vachat?.templates?.order_confirmation_template_name ??
              null,
            processing_template_name:
              templateDraft.processing_template_name ?? vachat?.templates?.processing_template_name ?? null,
            booked_template_name: templateDraft.booked_template_name ?? vachat?.templates?.booked_template_name ?? null,
            in_transit_template_name:
              templateDraft.in_transit_template_name ?? vachat?.templates?.in_transit_template_name ?? null,
            delivered_template_name:
              templateDraft.delivered_template_name ?? vachat?.templates?.delivered_template_name ?? null,
          },
          lastTestPhone: resolvedTestPhone || null,
        }),
      }),
    onSuccess: (result) => {
      toast.success("Global VaChat credentials saved.");
      if (result.templateSyncError) {
        toast.warning(`Templates were not updated on VaChat: ${result.templateSyncError}`);
      }
      setVachatKey("");
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testVachat = useMutation({
    mutationFn: () =>
      api("/api/admin/settings/vachat/test", {
        method: "POST",
        body: JSON.stringify({
          apiBaseUrl: resolvedVachatUrl,
          apiKey: vachatKey || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("VaChat API key verified (GET /api/v1/me). postbus:send is present.");
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const registerVachatWebhook = useMutation({
    mutationFn: () => api<VachatSettings>("/api/admin/settings/vachat/webhook", { method: "POST" }),
    onSuccess: () => {
      toast.success("VaChat status webhook registered.");
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendVachatTest = useMutation({
    mutationFn: () =>
      api<{ sent: boolean; to: string; event: string }>("/api/admin/settings/vachat/send-test", {
        method: "POST",
        body: JSON.stringify({ phone: resolvedTestPhone }),
      }),
    onSuccess: (result) => {
      toast.success(`TEST Booked WhatsApp sent to ${result.to}.`);
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnectVachat = useMutation({
    mutationFn: () =>
      api<VachatSettings>("/api/admin/settings/vachat", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
    onSuccess: () => {
      toast.success("Global VaChat disabled. Merchant WhatsApp is unchanged.");
      setVachatEnabled(false);
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function copyWebhookUrl() {
    if (!data?.webhookUrl) return;
    await navigator.clipboard.writeText(data.webhookUrl);
    toast.success("Webhook URL copied.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System settings"
        description="Connect Razorpay for billing and one global VaChat WhatsApp sender for every merchant. Secrets are encrypted and never shown again."
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Razorpay credentials</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={data?.connected ? "success" : "warning"}>
              {data?.connected ? "Connected" : "Not configured"}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {data?.mode ?? "test"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-6 pt-0">
          <div className="space-y-2">
            <Label htmlFor="rzp-key-id">Key ID</Label>
            <Input
              id="rzp-key-id"
              autoComplete="off"
              placeholder="rzp_live_… or rzp_test_…"
              value={resolvedKeyId}
              onChange={(event) => setKeyId(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rzp-key-secret">Key secret</Label>
            <Input
              id="rzp-key-secret"
              type="password"
              autoComplete="new-password"
              placeholder={data?.keySecretConfigured ? "Saved — leave blank to keep" : "Enter key secret"}
              value={keySecret}
              onChange={(event) => setKeySecret(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rzp-webhook-secret">Webhook secret</Label>
            <Input
              id="rzp-webhook-secret"
              type="password"
              autoComplete="new-password"
              placeholder={
                data?.webhookSecretConfigured
                  ? "Saved — leave blank to keep"
                  : "Optional here; generated when you register the webhook"
              }
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || !resolvedKeyId}>
              {save.isPending ? "Saving…" : "Save credentials"}
            </Button>
            <Button variant="secondary" onClick={() => testApi.mutate()} disabled={testApi.isPending}>
              {testApi.isPending ? "Testing…" : "Test API"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => registerWebhook.mutate()}
              disabled={registerWebhook.isPending || !data?.connected}
            >
              {registerWebhook.isPending ? "Registering…" : "Register billing webhook"}
            </Button>
          </div>
          {data?.source && data.source !== "none" ? (
            <p className="text-xs text-muted">Active source: {data.source}.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Global WhatsApp (VaChat)</CardTitle>
          <Badge variant={vachat?.connected ? "success" : "warning"}>
            {vachat?.connected ? "Connected" : "Not configured"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5 p-6 pt-0">
          <p className="text-sm text-muted">
            One official PostBus number on one VaChat account. Super Admin only. Merchants never paste a VaChat key
            while this is enabled. WATI stays independent.
          </p>
          {vachat?.identity?.display_phone || vachat?.identity?.verified_name ? (
            <p className="text-sm">
              Official number: <span className="font-medium">{vachat.identity.display_phone ?? "—"}</span>
              {vachat.identity.verified_name ? ` · ${vachat.identity.verified_name}` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted">Official number appears after Test API once WhatsApp is connected on VaChat.</p>
          )}
          {vachat?.lastError ? <p className="text-sm text-destructive">{vachat.lastError}</p> : null}
          {vachat?.lastVerifiedAt ? (
            <p className="text-xs text-muted">Last API test: {new Date(vachat.lastVerifiedAt).toLocaleString()}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <input
              id="vachat-enabled"
              type="checkbox"
              checked={resolvedVachatEnabled}
              onChange={(event) => setVachatEnabled(event.target.checked)}
            />
            <Label htmlFor="vachat-enabled">Enable global VaChat for all merchants</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vachat-url">VaChat base URL</Label>
            <Input
              id="vachat-url"
              autoComplete="off"
              placeholder="https://cloud.vachat.in"
              value={resolvedVachatUrl}
              onChange={(event) => setVachatUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vachat-key">API key</Label>
            <Input
              id="vachat-key"
              type="password"
              autoComplete="new-password"
              placeholder={vachat?.hasApiKey ? "Saved — leave blank to keep" : "wacrm_live_…"}
              value={vachatKey}
              onChange={(event) => setVachatKey(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => saveVachat.mutate()}
              disabled={saveVachat.isPending || (!vachat?.hasApiKey && !vachatKey)}
            >
              {saveVachat.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={() => testVachat.mutate()} disabled={testVachat.isPending}>
              {testVachat.isPending ? "Testing…" : "Test API"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => registerVachatWebhook.mutate()}
              disabled={registerVachatWebhook.isPending || !vachat?.hasApiKey}
            >
              {registerVachatWebhook.isPending ? "Registering…" : "Register status webhook"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => disconnectVachat.mutate()}
              disabled={disconnectVachat.isPending || !vachat?.enabled}
            >
              {disconnectVachat.isPending ? "Disabling…" : "Disable"}
            </Button>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Live events and templates</h3>
            <p className="text-xs text-muted">
              These switches are the Super Admin source of truth for VaChat. Merchant auto_wati_* flags remain WATI-only.
            </p>
            {vachat?.templatesLoadError ? (
              <p className="text-sm text-destructive">{vachat.templatesLoadError}</p>
            ) : null}
            {vachat?.hasApiKey && !vachat?.templatesLoadError && !(vachat?.templates?.approved_templates?.length) ? (
              <p className="text-xs text-muted">
                No approved WhatsApp templates were returned. Sync templates in VaChat, then refresh this page.
              </p>
            ) : null}
            {VACHAT_LIVE_EVENTS.map((event) => {
              const col = templateCol[event];
              const checked = eventDraft[event] ?? vachat?.eventSettings?.[event] ?? false;
              const value =
                templateDraft[col] ??
                (vachat?.templates?.[col as keyof NonNullable<VachatSettings["templates"]>] as string | null | undefined) ??
                "";
              const approved = vachat?.templates?.approved_templates ?? [];
              const options = approved.map((tpl) => ({
                value: tpl.name,
                label: `${tpl.name} (${tpl.language})`,
              }));
              if (value && !options.some((opt) => opt.value === value)) {
                options.unshift({ value, label: value });
              }
              return (
                <div key={event} className="space-y-2 rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`vachat-ev-${event}`} className="text-sm capitalize">
                      {event.replaceAll("_", " ")}
                    </Label>
                    <input
                      id={`vachat-ev-${event}`}
                      type="checkbox"
                      checked={checked}
                      onChange={(change) =>
                        setEventDraft((prev) => ({ ...prev, [event]: change.target.checked }))
                      }
                    />
                  </div>
                  <Combobox
                    id={`vachat-tpl-${event}`}
                    options={options}
                    value={value}
                    onChange={(next) => setTemplateDraft((prev) => ({ ...prev, [col]: next }))}
                    placeholder="Select an approved template"
                    emptyText={approved.length ? "No matching template" : "No approved templates loaded"}
                  />
                </div>
              );
            })}
          </div>
          <div className="space-y-2">
            <Label htmlFor="vachat-test-phone">TEST WhatsApp number</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="vachat-test-phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="Enter a test number"
                value={resolvedTestPhone}
                onChange={(event) => setVachatTestPhone(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => sendVachatTest.mutate()}
                disabled={sendVachatTest.isPending || !vachat?.connected || !resolvedTestPhone}
              >
                {sendVachatTest.isPending ? "Sending…" : "Send TEST booked"}
              </Button>
            </div>
            <p className="text-xs text-muted">
              Explicit TEST send only. Never uses a customer phone. Saves the last test number.
            </p>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            {(["today", "last7d", "last30d"] as const).map((window) => {
              const counts = vachatStatsQuery.data?.[window] ?? {};
              return (
                <div key={window} className="rounded-md border p-2">
                  <p className="font-medium capitalize">{window === "last7d" ? "7 days" : window === "last30d" ? "30 days" : "Today"}</p>
                  <p className="text-muted">
                    {Object.entries(counts)
                      .map(([status, count]) => `${status}: ${count}`)
                      .join(" · ") || "No sends"}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Notification log</h3>
            <div className="max-h-64 overflow-auto rounded-md border text-xs">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-2">When</th>
                    <th className="p-2">Org</th>
                    <th className="p-2">Event</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {(vachatLogsQuery.data ?? []).map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="p-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="p-2 font-mono">{row.organization_id.slice(0, 8)}</td>
                      <td className="p-2">{row.event}</td>
                      <td className="p-2">{row.status}</td>
                      <td className="p-2 font-mono">{row.external_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!vachatLogsQuery.data?.length ? (
                <p className="p-3 text-muted">No VaChat sends logged yet.</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={vachat?.webhookUrl ?? ""} />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                if (!vachat?.webhookUrl) return;
                await navigator.clipboard.writeText(vachat.webhookUrl);
                toast.success("Webhook URL copied.");
              }}
              disabled={!vachat?.webhookUrl}
            >
              Copy URL
            </Button>
          </div>
          {vachat?.webhookEndpointId ? (
            <p className="text-xs text-muted">Registered webhook id: {vachat.webhookEndpointId}</p>
          ) : (
            <p className="text-xs text-muted">Not registered yet. Use the button above after saving a key.</p>
          )}
          {vachat?.source && vachat.source !== "none" ? (
            <p className="text-xs text-muted">Active source: {vachat.source}.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Billing cycle webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-0 text-sm">
          <p className="text-muted">
            Razorpay must POST subscription charges to this URL so periods renew, usage resets, and invoices are recorded.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={data?.webhookUrl ?? ""} />
            <Button type="button" variant="secondary" onClick={copyWebhookUrl} disabled={!data?.webhookUrl}>
              Copy URL
            </Button>
          </div>
          {data?.webhookId ? (
            <p className="text-xs text-muted">Registered webhook id: {data.webhookId}</p>
          ) : (
            <p className="text-xs text-muted">Not registered yet. Use the button above or paste the URL in the Razorpay dashboard.</p>
          )}
          <div>
            <p className="mb-2 font-medium">Required events</p>
            <ul className="grid gap-1 text-xs text-muted sm:grid-cols-2">
              {(data?.webhookEvents ?? []).map((event) => (
                <li key={event} className="font-mono">
                  {event}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 p-6 text-sm text-muted">
          <p>Grant Super Admin access by inserting into platform_admins, or set PLATFORM_ADMIN_EMAIL to bootstrap the first operator.</p>
          <p>Trial length is edited under Trial Settings. Plan prices and order limits are edited under Plans.</p>
        </CardContent>
      </Card>
    </div>
  );
}
