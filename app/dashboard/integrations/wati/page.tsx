"use client";

import { useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { ChevronDown, Copy } from "lucide-react";
import type { WatiConfig } from "@/types/api";

const WATI_WHATSAPP_NUMBER = "+917012788341";

function watiNumberOption(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  const trimmed = (value ?? "").trim();
  return trimmed;
}

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
    hint: "Sent after booking. Includes tracking ID and the customer tracking page.",
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
  const [channelPhone, setChannelPhone] = useState(WATI_WHATSAPP_NUMBER);
  const [hydrated, setHydrated] = useState(false);

  const query = useQuery({
    queryKey: ["wati"],
    queryFn: () => api<WatiConfig>("/api/v1/integrations/wati"),
  });

  const config = query.data;
  const hasToken = Boolean(config?.hasToken ?? config?.has_token);
  const templates = (config?.templates ?? []).filter((template) => template.name);
  const templateNames = new Set(templates.map((template) => template.name));
  const allowedSlot = (name?: string | null) => (name && templateNames.has(name) ? name : "");

  useEffect(() => {
    if (!config || hydrated) return;
    setHydrated(true);
    setClientId(config.clientId ?? config.client_id ?? "");
    setBaseUrl(config.apiBaseUrl ?? config.api_base_url ?? "");
    setChannelPhone(watiNumberOption(config.channelPhone ?? config.channel_phone) || WATI_WHATSAPP_NUMBER);
    setSlots({
      orderConfirmation: allowedSlot(config.orderConfirmationTemplateName ?? config.order_confirmation_template_name),
      processing: allowedSlot(config.processingTemplateName ?? config.processing_template_name),
      booked: allowedSlot(config.bookedTemplateName ?? config.booked_template_name),
      inTransit: allowedSlot(config.inTransitTemplateName ?? config.in_transit_template_name),
      delivered: allowedSlot(config.deliveredTemplateName ?? config.delivered_template_name),
    });
  }, [config, hydrated]);

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
          channelPhone: channelPhone.trim() || null,
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
  const phoneOptions = watiPhoneOptions(config?.channels, channelPhone, config?.channelPhone ?? config?.channel_phone);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wati"
        description="Choose an approved Utility template for each order stage. Automation uses the same stages: new Shopify order, Processing, Booked, In transit, and Delivered."
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
              Required to register the webhook. The ID after live-mt-server.wati.io/ on the API Docs
              page. V3 keeps it out of the request path.
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
            <Label htmlFor="wati-channel-phone">WhatsApp number</Label>
            <Select value={channelPhone || WATI_WHATSAPP_NUMBER} onValueChange={setChannelPhone}>
              <SelectTrigger id="wati-channel-phone">
                <SelectValue placeholder={WATI_WHATSAPP_NUMBER} />
              </SelectTrigger>
              <SelectContent>
                {phoneOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted">
              Order messages and the webhook use this Wati line. {WATI_WHATSAPP_NUMBER} stays in the list
              when Wati does not return the default channel.
            </p>
          </div>
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
          {config?.channelName || config?.channel_name ? (
            <p className="text-sm text-muted">
              Connected channel {config.channelName ?? config.channel_name}
              {config.channelPhone ?? config.channel_phone
                ? ` · ${watiNumberOption(config.channelPhone ?? config.channel_phone)}`
                : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipment templates</CardTitle>
          <CardDescription>
            Only approved Utility templates from Wati are listed. Marketing and authentication
            templates stay hidden. Parameters sent: customer_name, order_number, tracking_number,
            and tracking_url (your published customer tracking page).
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
              Save and connect to load approved Utility templates. Pending, rejected, marketing, and
              authentication templates stay hidden.
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
                ? ` Register to subscribe ${watiNumberOption(config?.channelPhone ?? config?.channel_phone) || channelPhone} in Wati.`
                : " This URL is not public HTTPS, so Wati cannot call it yet."}
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

function watiPhoneOptions(
  channels: WatiConfig["channels"],
  selected?: string | null,
  saved?: string | null
) {
  const options = new Map<string, string>();
  const add = (raw?: string | null, label?: string) => {
    const value = watiNumberOption(raw);
    if (!value || options.has(value)) return;
    options.set(value, label || value);
  };

  add(WATI_WHATSAPP_NUMBER, WATI_WHATSAPP_NUMBER);
  for (const channel of channels ?? []) {
    const value = watiNumberOption(channel.platform_id);
    const name = channel.name?.trim();
    add(value, name && value ? `${name} · ${value}` : value || name);
  }
  add(saved);
  add(selected);
  return [...options.entries()].map(([value, label]) => ({ value, label }));
}

function templatePreview(body?: string | null) {
  return (body ?? "").replace(/\s+/g, " ").trim();
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
  templates: Array<{ name?: string; status?: string | null; body?: string | null }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = templates.filter((template) => template.name);
  const selected = options.find((template) => template.name === value);
  const preview = templatePreview(selected?.body);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative space-y-2", open && "z-50")}>
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-input)] border border-border bg-card px-3.5 text-left text-sm text-foreground shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected?.name ? "truncate" : "text-muted"}>{selected?.name || "None"}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-[0_1px_2px_rgb(9_9_11/0.05),0_12px_40px_rgb(9_9_11/0.08)]"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              className="flex w-full px-3 py-2 text-left text-sm hover:bg-surface-soft"
              onClick={() => choose("")}
            >
              None
            </button>
          </li>
          {options.map((template) => (
            <li key={template.name}>
              <button
                type="button"
                role="option"
                aria-selected={template.name === value}
                className={cn(
                  "flex w-full flex-col px-3 py-2 text-left hover:bg-surface-soft",
                  template.name === value ? "bg-surface-soft" : ""
                )}
                onClick={() => choose(template.name || "")}
              >
                <span className="text-sm text-foreground">{template.name}</span>
                {templatePreview(template.body) ? (
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted">{templatePreview(template.body)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {preview ? (
        <p className="whitespace-pre-wrap rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted">
          {selected?.body?.trim()}
        </p>
      ) : null}
    </div>
  );
}
