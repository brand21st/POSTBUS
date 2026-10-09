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
import { api } from "@/lib/hooks/use-api";

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
  "shipment_delayed",
  "delivered",
] as const;

type VachatEventKey = (typeof VACHAT_LIVE_EVENTS)[number];

type VachatSettings = {
  enabled: boolean;
  supportEnabled?: boolean;
  connected: boolean;
  status: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  keyMasked: string;
  webhookSecretConfigured: boolean;
  webhookEndpointId: string | null;
  webhookUrl: string;
  mcpUrl?: string;
  mcpAccount?: string;
  mcpWhatsapp?: string;
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
      shipment_delayed_template_name?: string | null;
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

type OpenRouterSettings = {
  enabled: boolean;
  connected: boolean;
  hasApiKey: boolean;
  keyMasked: string;
  model: string;
  source: string;
  packSize?: number;
  packPaise?: number;
  models?: Array<{ id: string; name: string }>;
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

type UnassignedThread = {
  id: string;
  phone_digits: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  status: string;
  resolution_state?: string;
};

export default function AdminSettingsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "settings", "razorpay"],
    queryFn: () => api<RazorpaySettings>("/api/admin/settings/razorpay"),
  });
  const openrouterQuery = useQuery({
    queryKey: ["admin", "settings", "openrouter"],
    queryFn: () => api<OpenRouterSettings>("/api/admin/settings/openrouter"),
  });
  const openrouterModelsQuery = useQuery({
    queryKey: ["admin", "settings", "openrouter", "models"],
    queryFn: () =>
      api<{ models: Array<{ id: string; name: string }>; selected: string }>(
        "/api/admin/settings/openrouter/models"
      ),
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
  const unassignedQuery = useQuery({
    queryKey: ["admin", "settings", "vachat", "unassigned"],
    queryFn: () =>
      api<{ items: UnassignedThread[]; count: number; counts?: Record<string, number> }>(
        "/api/admin/settings/vachat/unassigned"
      ),
  });
  const data = query.data;
  const vachat = vachatQuery.data;
  const openrouter = openrouterQuery.data;
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("");
  const [openrouterEnabled, setOpenrouterEnabled] = useState<boolean | null>(null);
  const [vachatKey, setVachatKey] = useState("");
  const [vachatUrl, setVachatUrl] = useState("");
  const [vachatEnabled, setVachatEnabled] = useState<boolean | null>(null);
  const [assignOrderId, setAssignOrderId] = useState("");
  const [vachatTestPhone, setVachatTestPhone] = useState("");
  const [eventDraft, setEventDraft] = useState<Partial<Record<VachatEventKey, boolean>>>({});
  const [templateDraft, setTemplateDraft] = useState<Partial<Record<string, string>>>({});
  const resolvedKeyId = keyId || data?.keyId || "";
  const resolvedVachatUrl = vachatUrl || vachat?.apiBaseUrl || "https://cloud.vachat.in";
  const resolvedOpenrouterEnabled = openrouterEnabled ?? openrouter?.enabled ?? false;
  const chatgptModels = openrouterModelsQuery.data?.models ?? openrouter?.models ?? [];
  const resolvedOpenrouterModel = openrouterModel || openrouter?.model || "openai/gpt-4o-mini";
  const resolvedVachatEnabled = vachatEnabled ?? vachat?.enabled ?? false;
  const resolvedTestPhone = vachatTestPhone || vachat?.lastTestPhone || "";
  const templateCol: Record<VachatEventKey, string> = {
    order_confirmation: "order_confirmation_template_name",
    processing: "processing_template_name",
    booked: "booked_template_name",
    in_transit: "in_transit_template_name",
    shipment_delayed: "shipment_delayed_template_name",
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

  const saveOpenrouter = useMutation({
    mutationFn: () =>
      api<OpenRouterSettings>("/api/admin/settings/openrouter", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: resolvedOpenrouterEnabled,
          model: resolvedOpenrouterModel,
          apiKey: openrouterKey || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("OpenRouter credentials saved.");
      setOpenrouterKey("");
      client.invalidateQueries({ queryKey: ["admin", "settings", "openrouter"] });
      client.invalidateQueries({ queryKey: ["admin", "settings", "openrouter", "models"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testOpenrouter = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; model: string; label: string | null }>("/api/admin/settings/openrouter/test", {
        method: "POST",
        body: JSON.stringify({ apiKey: openrouterKey || undefined }),
      }),
    onSuccess: (result) => {
      toast.success(result.label ? `OpenRouter OK (${result.label}).` : "OpenRouter API OK.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnectOpenrouter = useMutation({
    mutationFn: () =>
      api<OpenRouterSettings>("/api/admin/settings/openrouter", {
        method: "PATCH",
        body: JSON.stringify({ clearKey: true, enabled: false }),
      }),
    onSuccess: () => {
      toast.success("OpenRouter disconnected.");
      setOpenrouterEnabled(false);
      setOpenrouterKey("");
      client.invalidateQueries({ queryKey: ["admin", "settings", "openrouter"] });
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
            shipment_delayed: eventDraft.shipment_delayed ?? vachat?.eventSettings?.shipment_delayed ?? false,
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
            shipment_delayed_template_name:
              templateDraft.shipment_delayed_template_name ??
              vachat?.templates?.shipment_delayed_template_name ??
              null,
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
        body: JSON.stringify({ phone: resolvedTestPhone.trim() || "918618456029" }),
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

  const saveSupportEnabled = useMutation({
    mutationFn: (supportEnabled: boolean) =>
      api<VachatSettings>("/api/admin/settings/vachat", {
        method: "PATCH",
        body: JSON.stringify({ supportEnabled }),
      }),
    onSuccess: (result) => {
      toast.success(
        result.supportEnabled
          ? "Support Center can use PostBus WhatsApp."
          : "Support Center PostBus WhatsApp is off. Shipping notices are unchanged."
      );
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const assignUnassigned = useMutation({
    mutationFn: (threadId: string) =>
      api("/api/admin/settings/vachat/unassigned/assign", {
        method: "POST",
        body: JSON.stringify({ threadId, orderId: assignOrderId.trim() }),
      }),
    onSuccess: () => {
      toast.success("Thread assigned from the verified order.");
      setAssignOrderId("");
      client.invalidateQueries({ queryKey: ["admin", "settings", "vachat", "unassigned"] });
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
        description="Connect Razorpay for billing, OpenRouter for WhatsApp paste autofill, and one global VaChat WhatsApp sender. Secrets are encrypted and never shown again."
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
          <CardTitle>OpenRouter (WhatsApp paste)</CardTitle>
          <Badge variant={openrouter?.connected ? "success" : "warning"}>
            {openrouter?.connected ? "Connected" : "Not configured"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5 p-6 pt-0">
          <p className="text-sm text-muted">
            One platform key for every merchant. Parse message on Add order uses AI to fill name, phone, and address.
            If the key is off or the request fails, the local parser still runs.
          </p>
          {openrouter?.hasApiKey && openrouter.keyMasked ? (
            <p className="text-xs text-muted">Saved key: {openrouter.keyMasked}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <input
              id="openrouter-enabled"
              type="checkbox"
              checked={resolvedOpenrouterEnabled}
              onChange={(event) => setOpenrouterEnabled(event.target.checked)}
            />
            <Label htmlFor="openrouter-enabled">Enable AI parse for pasted WhatsApp customer details</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="openrouter-model">ChatGPT model</Label>
            <Combobox
              id="openrouter-model"
              placeholder={openrouterModelsQuery.isPending ? "Loading ChatGPT models…" : "Select a ChatGPT model"}
              emptyText="No ChatGPT models found"
              value={resolvedOpenrouterModel}
              onChange={(value) => setOpenrouterModel(value)}
              options={
                chatgptModels.length
                  ? chatgptModels.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))
                  : [{ value: resolvedOpenrouterModel, label: resolvedOpenrouterModel }]
              }
            />
            <p className="text-xs text-muted">OpenAI ChatGPT models via OpenRouter. Save after changing the model.</p>
          </div>
          <p className="text-xs text-muted">
            Package prices live on{" "}
            <a href="/admin/ai-credits" className="font-medium text-brand underline-offset-2 hover:underline">
              AI Credits
            </a>
            .
          </p>
          <div className="space-y-2">
            <Label htmlFor="openrouter-key">API key</Label>
            <Input
              id="openrouter-key"
              type="password"
              autoComplete="new-password"
              placeholder={openrouter?.hasApiKey ? "Saved — leave blank to keep" : "sk-or-v1-…"}
              value={openrouterKey}
              onChange={(event) => setOpenrouterKey(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => saveOpenrouter.mutate()}
              disabled={saveOpenrouter.isPending || (!openrouter?.hasApiKey && !openrouterKey)}
            >
              {saveOpenrouter.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={() => testOpenrouter.mutate()} disabled={testOpenrouter.isPending}>
              {testOpenrouter.isPending ? "Testing…" : "Test API"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => disconnectOpenrouter.mutate()}
              disabled={disconnectOpenrouter.isPending || !openrouter?.hasApiKey}
            >
              {disconnectOpenrouter.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>PostBus WhatsApp Notifications</CardTitle>
          <Badge variant={vachat?.connected ? "success" : "warning"}>
            {vachat?.connected ? "Connected" : "Not configured"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5 p-6 pt-0">
          <p className="text-sm text-muted">
            One official PostBus number on one VaChat account. Super Admin only. Merchants who connect their own
            Vachat use that account instead — PostBus WhatsApp Notifications stay hidden for that workspace. WATI stays
            independent.
          </p>
          {vachat?.identity?.display_phone || vachat?.identity?.verified_name ? (
            <p className="text-sm">
              Official number:{" "}
              <span className="font-medium">
                {vachat.identity.display_phone ?? vachat.mcpWhatsapp ?? "+918618456029"}
              </span>
              {vachat.identity.verified_name ? ` · ${vachat.identity.verified_name}` : " · post@post.com"}
            </p>
          ) : (
            <p className="text-sm text-muted">
              Official PostBus WhatsApp: {vachat?.mcpWhatsapp ?? "+918618456029"} · account post@post.com
            </p>
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
            <Label htmlFor="vachat-enabled">Enable PostBus WhatsApp Notifications for merchants without Vachat</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="vachat-support-enabled"
              type="checkbox"
              checked={Boolean(vachat?.supportEnabled)}
              disabled={saveSupportEnabled.isPending || !vachat?.connected}
              onChange={(event) => saveSupportEnabled.mutate(event.target.checked)}
            />
            <Label htmlFor="vachat-support-enabled">
              Support Center on PostBus WhatsApp (does not change shipping templates)
            </Label>
          </div>
          <p className="text-xs text-muted">
            Health: shipping {vachat?.connected ? "connected" : "off"} · support messaging{" "}
            {vachat?.supportEnabled ? "on" : "off"} · unassigned {unassignedQuery.data?.count ?? 0}
          </p>
          <div className="space-y-2 rounded-lg border p-3">
            <h3 className="text-sm font-medium">Unassigned Support Center chats</h3>
            <p className="text-xs text-muted">
              Verified {unassignedQuery.data?.counts?.VERIFIED ?? 0} · Pending{" "}
              {unassignedQuery.data?.counts?.VERIFICATION_REQUIRED ?? 0} · Ambiguous{" "}
              {(unassignedQuery.data?.counts?.AMBIGUOUS ?? 0) + (unassignedQuery.data?.counts?.MULTIPLE_MATCHES ?? 0)}{" "}
              · Not found{" "}
              {(unassignedQuery.data?.counts?.NOT_FOUND ?? 0) + (unassignedQuery.data?.counts?.ORDER_NOT_FOUND ?? 0)}.
              Assign only with a verified order id that matches this WhatsApp number.
            </p>
            <Input
              placeholder="Order UUID"
              value={assignOrderId}
              onChange={(event) => setAssignOrderId(event.target.value)}
            />
            {(unassignedQuery.data?.items ?? []).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">+91 {row.phone_digits}</p>
                  <p className="text-xs text-muted">
                    {row.resolution_state ?? "VERIFICATION_REQUIRED"} · {row.last_message_preview || "No preview"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!assignOrderId.trim() || assignUnassigned.isPending}
                  onClick={() => assignUnassigned.mutate(row.id)}
                >
                  Assign
                </Button>
              </div>
            ))}
            {!unassignedQuery.data?.items?.length ? (
              <p className="text-xs text-muted">No unassigned threads.</p>
            ) : null}
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
              const approved: Array<{ name: string; language: string }> =
                vachat?.templates?.approved_templates ?? [];
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
                placeholder="918618456029"
                value={resolvedTestPhone}
                onChange={(event) => setVachatTestPhone(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => sendVachatTest.mutate()}
                disabled={sendVachatTest.isPending || !(vachat?.hasApiKey || vachatKey)}
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
                      <td className="p-2">
                        <div>{row.status}</div>
                        {row.error ? <div className="mt-1 max-w-xs text-destructive">{row.error}</div> : null}
                      </td>
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
          <div className="space-y-2">
            <Label>VaChat order-search MCP</Label>
            <p className="text-sm text-muted">
              Add this remote MCP in VaChat for account {vachat?.mcpAccount ?? "post@post.com"} on WhatsApp{" "}
              {vachat?.mcpWhatsapp ?? "+918618456029"}. Tools{" "}
              <span className="font-mono">search_order_details</span> and{" "}
              <span className="font-mono">search_merchant_organization</span> live-fetch the bound support session’s
              merchant, order, and India Post tracking at https://www.postbus.in/track. Session context is injected by
              the PostBus webhook — do not treat <span className="font-mono">session_id</span> or WhatsApp fields as
              authorization. Auth: Bearer using the API key above.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={vachat?.mcpUrl ?? ""} />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if (!vachat?.mcpUrl) return;
                  await navigator.clipboard.writeText(vachat.mcpUrl);
                  toast.success("MCP URL copied.");
                }}
                disabled={!vachat?.mcpUrl}
              >
                Copy MCP
              </Button>
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
