"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { Copy } from "lucide-react";
import type { WatiConfig } from "@/types/api";

const NONE = "__none__";

const TEMPLATE_SLOTS = [
  {
    key: "orderConfirmation",
    label: "Order confirmation",
    hint: "Sent when a new Shopify order arrives.",
  },
  {
    key: "processing",
    label: "Processing",
    hint: "Sent when the order is being processed.",
  },
  {
    key: "booked",
    label: "Booked / packed",
    hint: "Sent after booking. Includes tracking ID and tracking link.",
  },
  {
    key: "inTransit",
    label: "In transit",
    hint: "Sent when India Post first moves the article.",
  },
  {
    key: "delivered",
    label: "Delivered",
    hint: "Sent when the shipment is delivered.",
  },
] as const;

type SlotKey = (typeof TEMPLATE_SLOTS)[number]["key"];

export default function WatiIntegrationPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [replaceToken, setReplaceToken] = useState(false);
  const [slots, setSlots] = useState<Record<SlotKey, string>>({
    orderConfirmation: "",
    processing: "",
    booked: "",
    inTransit: "",
    delivered: "",
  });
  const [testPhone, setTestPhone] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const query = useQuery({
    queryKey: ["wati"],
    queryFn: () => api<WatiConfig>("/api/v1/integrations/wati"),
  });

  const config = query.data;
  const hasToken = Boolean(config?.hasToken ?? config?.has_token);
  const templates = (config?.templates ?? []).filter((template) => template.name);

  if (config && !hydrated) {
    setHydrated(true);
    setClientId(config.clientId ?? config.client_id ?? "");
    setBaseUrl(config.apiBaseUrl ?? config.api_base_url ?? "");
    setSlots({
      orderConfirmation: config.orderConfirmationTemplateName ?? config.order_confirmation_template_name ?? "",
      processing: config.processingTemplateName ?? config.processing_template_name ?? "",
      booked: config.bookedTemplateName ?? config.booked_template_name ?? "",
      inTransit: config.inTransitTemplateName ?? config.in_transit_template_name ?? "",
      delivered: config.deliveredTemplateName ?? config.delivered_template_name ?? "",
    });
  }

  const save = useMutation({
    mutationFn: () => {
      if (!hasToken && !token.trim()) {
        throw new Error("Paste your Wati API token.");
      }
      return api<WatiConfig>("/api/v1/integrations/wati", {
        method: "POST",
        body: JSON.stringify({
          apiToken: replaceToken || !hasToken ? token.trim() || undefined : undefined,
          clientId: clientId.trim() || null,
          apiBaseUrl: baseUrl.trim() || undefined,
          orderConfirmationTemplateName: slots.orderConfirmation || null,
          processingTemplateName: slots.processing || null,
          bookedTemplateName: slots.booked || null,
          inTransitTemplateName: slots.inTransit || null,
          deliveredTemplateName: slots.delivered || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Wati connected with API V3.");
      setToken("");
      setReplaceToken(false);
      queryClient.invalidateQueries({ queryKey: ["wati"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const verify = useMutation({
    mutationFn: () => api("/api/v1/integrations/wati/verify", { method: "POST" }),
    onSuccess: () => {
      toast.success("Wati token verified.");
      queryClient.invalidateQueries({ queryKey: ["wati"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selectedTemplate =
    slots.booked || slots.orderConfirmation || slots.processing || slots.delivered || slots.inTransit;

  const test = useMutation({
    mutationFn: () =>
      api("/api/v1/integrations/wati/test", {
        method: "POST",
        body: JSON.stringify({
          phone: testPhone,
          templateName: selectedTemplate,
        }),
      }),
    onSuccess: () => toast.success("Test template accepted by Wati."),
    onError: (error: Error) => toast.error(error.message),
  });

  const registerWebhook = useMutation({
    mutationFn: () => api<WatiConfig>("/api/v1/integrations/wati/webhooks", { method: "POST" }),
    onSuccess: () => {
      toast.success("Wati webhook registered.");
      queryClient.invalidateQueries({ queryKey: ["wati"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const webhookUrl = config?.webhookUrl ?? config?.webhook_url ?? "";
  const canRegisterWebhook = Boolean(config?.canRegisterWebhook ?? config?.can_register_webhook);
  const lastWebhookAt = config?.lastWebhookAt ?? config?.last_webhook_at;
  const lastWebhookEvent = config?.lastWebhookEvent ?? config?.last_webhook_event;
  const lastWebhookError = config?.lastWebhookError ?? config?.last_webhook_error;
  const webhookRegistered = Boolean(config?.webhookId ?? config?.webhook_id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wati"
        description="Connect WhatsApp with a Wati API V3 token. Choose an approved template for each order stage."
        actions={<StatusBadge value={config?.status ?? "NOT_CONNECTED"} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>API token</CardTitle>
          <CardDescription>
            In Wati go to Connector → API → Create API Token. Copy Client ID from the API Docs
            endpoint if shown. Use V3 scopes for channels and message templates. Do not put the
            Client ID in the host URL.
            {config?.lastVerifiedAt || config?.last_verified_at
              ? ` Last verified ${formatDate(config?.lastVerifiedAt ?? config?.last_verified_at, true)}.`
              : ""}
            {config?.lastError || config?.last_error
              ? ` Latest error: ${config.lastError ?? config.last_error}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4">
          <div className="space-y-2">
            <Label htmlFor="wati-client-id">Client ID</Label>
            <Input
              id="wati-client-id"
              autoComplete="off"
              placeholder="Workspace ID from Wati API Docs"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
            <p className="text-xs text-muted">
              Optional. The ID after live-mt-server.wati.io/ on the API Docs page. V3 keeps it out of
              the request path.
            </p>
          </div>
          {hasToken && !replaceToken ? (
            <div className="space-y-2">
              <Label>API token</Label>
              <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                Token saved encrypted.
                <button
                  type="button"
                  className="ml-2 font-medium text-brand hover:underline"
                  onClick={() => setReplaceToken(true)}
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="wati-token">API token</Label>
              <Input
                id="wati-token"
                type="password"
                autoComplete="off"
                placeholder="wati_… or Bearer token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="wati-base">API host</Label>
            <Input
              id="wati-base"
              placeholder="https://live-mt-server.wati.io"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <p className="text-xs text-muted">Leave blank to use the Wati V3 host.</p>
          </div>
          {config?.channelName || config?.channel_name || config?.channelPhone || config?.channel_phone ? (
            <p className="text-sm text-muted">
              Channel {config.channelName ?? config.channel_name}
              {config.channelPhone ?? config.channel_phone
                ? ` · ${config.channelPhone ?? config.channel_phone}`
                : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipment templates</CardTitle>
          <CardDescription>
            Only approved WhatsApp templates from Wati are listed. Parameters sent: customer_name,
            order_number, tracking_number, tracking_url.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4">
          {TEMPLATE_SLOTS.map((slot) => (
            <TemplateSelect
              key={slot.key}
              label={slot.label}
              hint={slot.hint}
              value={slots[slot.key]}
              templates={templates}
              onChange={(value) => setSlots((current) => ({ ...current, [slot.key]: value }))}
            />
          ))}
          {!templates.length ? (
            <p className="text-xs text-muted">
              Save and connect to load approved templates. Pending or rejected templates stay hidden.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="wati-test-phone">Test WhatsApp number</Label>
            <Input
              id="wati-test-phone"
              inputMode="tel"
              placeholder="9876543210"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {webhookUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>Webhook</CardTitle>
            <CardDescription>
              Incoming WhatsApp replies and failed templates are stored on this connection.
              {canRegisterWebhook
                ? " Register to subscribe those events in Wati automatically."
                : " On localhost Wati cannot reach this URL. After deploy, register it or paste the URL in Wati Connectors → Webhooks."}
              {lastWebhookAt
                ? ` Last event ${lastWebhookEvent ?? "unknown"} at ${formatDate(lastWebhookAt, true)}.`
                : ""}
              {lastWebhookError ? ` Latest webhook error: ${lastWebhookError}` : ""}
              {webhookRegistered && !lastWebhookError ? " Subscription is registered." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid max-w-xl gap-4">
            <div className="space-y-2">
              <Label htmlFor="wati-webhook-url">Webhook URL</Label>
              <div className="flex gap-2">
                <Input id="wati-webhook-url" readOnly value={webhookUrl} />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!webhookUrl}
                  onClick={async () => {
                    await navigator.clipboard.writeText(webhookUrl);
                    toast.success("Webhook URL copied.");
                  }}
                >
                  <Copy />
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => registerWebhook.mutate()}
                disabled={!hasToken || !canRegisterWebhook || registerWebhook.isPending}
              >
                {registerWebhook.isPending ? "Registering…" : webhookRegistered ? "Update subscription" : "Register webhook"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Connecting…" : "Save and connect"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => verify.mutate()} disabled={!hasToken || verify.isPending}>
          Verify
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => test.mutate()}
          disabled={!hasToken || test.isPending || !testPhone.trim() || !selectedTemplate}
        >
          Send test
        </Button>
      </div>
    </div>
  );
}

function TemplateSelect({
  label,
  hint,
  value,
  templates,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  templates: Array<{ name?: string; status?: string | null }>;
  onChange: (value: string) => void;
}) {
  const options = templates.filter((template) => template.name);
  if (value && !options.some((template) => template.name === value)) {
    options.unshift({ name: value, status: "APPROVED" });
  }

  return (
    <div className="space-y-2">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
        <SelectTrigger>
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {options.map((template) => (
            <SelectItem key={template.name} value={template.name ?? ""}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
