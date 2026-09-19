"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { ShopifyConfig } from "@/types/api";

type FormState = {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
};

const EMPTY: FormState = {
  shopDomain: "",
  clientId: "",
  clientSecret: "",
};

export default function ShopifyIntegrationPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [replaceSecret, setReplaceSecret] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const query = useQuery({
    queryKey: ["shopify"],
    queryFn: () => api<ShopifyConfig>("/api/v1/integrations/shopify"),
  });
  const config = query.data;
  const hasClientSecret = Boolean(config?.hasClientSecret ?? config?.has_client_secret ?? config?.hasApiSecret);
  const scopes = config?.requestedScopes ?? config?.requested_scopes ?? "";
  const webhookUrl = config?.webhookUrl ?? config?.webhook_url ?? "";
  const appConfigured = Boolean(config?.appConfigured);
  const status = config?.status ?? "NOT_CONNECTED";

  useEffect(() => {
    if (!config || hydrated) return;
    setForm({
      shopDomain: config.shopDomain ?? config.shop_domain ?? "",
      clientId: config.clientId ?? config.client_id ?? "",
      clientSecret: "",
    });
    setHydrated(true);
  }, [config, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      api<ShopifyConfig>("/api/v1/integrations/shopify", {
        method: "POST",
        body: JSON.stringify({
          shopDomain: form.shopDomain,
          clientId: form.clientId,
          clientSecret: form.clientSecret || undefined,
          requestedScopes: scopes || undefined,
        }),
      }),
    onSuccess: (data) => {
      toast.success("Shopify Client ID saved. Client secret is stored encrypted.");
      setForm({
        shopDomain: data.shopDomain ?? data.shop_domain ?? form.shopDomain,
        clientId: data.clientId ?? data.client_id ?? form.clientId,
        clientSecret: "",
      });
      setReplaceSecret(false);
      queryClient.invalidateQueries({ queryKey: ["shopify"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function copyValue(value: string, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  }

  function connect() {
    const shop = form.shopDomain || config?.shopDomain || config?.shop_domain || "";
    const href = shop
      ? `${window.location.origin}/api/v1/integrations/shopify/connect?shop=${encodeURIComponent(shop)}`
      : `${window.location.origin}/api/v1/integrations/shopify/connect`;
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Shopify OAuth must leave the app
    window.location.assign(href);
  }

  const canSave = Boolean(form.shopDomain && form.clientId && (hasClientSecret || form.clientSecret));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shopify"
        description="Paste Client ID and Client secret from Shopify Dev Dashboard → Apps → Settings → Credentials."
        actions={<StatusBadge value={status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>App credentials</CardTitle>
          <CardDescription>
            Client ID identifies the app. Client secret authorizes OAuth and signs webhooks — it is encrypted at rest and never shown again.{" "}
            <a
              href="https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand hover:underline"
            >
              Find credentials
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="shop">Shop domain</Label>
            <Input
              id="shop"
              placeholder="your-store.myshopify.com"
              value={form.shopDomain}
              onChange={(event) => setForm((current) => ({ ...current, shopDomain: event.target.value }))}
            />
          </div>

          <CopyField
            id="clientId"
            label="Client ID"
            value={form.clientId}
            placeholder="From Shopify Dev Dashboard → Credentials"
            readOnly={false}
            onChange={(value) => setForm((current) => ({ ...current, clientId: value }))}
            onCopy={() => copyValue(form.clientId, "Client ID")}
          />

          {hasClientSecret && !replaceSecret ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
              Client secret saved and encrypted.
              <button
                type="button"
                className="ml-2 font-medium text-brand hover:underline"
                onClick={() => setReplaceSecret(true)}
              >
                Rotate secret
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client secret</Label>
              <Input
                id="clientSecret"
                type="password"
                autoComplete="new-password"
                placeholder={hasClientSecret ? "Paste the new Client secret" : "Paste the Client secret"}
                value={form.clientSecret}
                onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))}
              />
            </div>
          )}

          <CopyField
            id="scopes"
            label="Scopes"
            value={scopes}
            onCopy={() => copyValue(scopes, "Scopes")}
          />
          <CopyField
            id="webhook"
            label="Webhook URL"
            value={webhookUrl}
            onCopy={() => copyValue(webhookUrl, "Webhook URL")}
          />

          <div>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !canSave}>
              {save.isPending ? "Saving…" : "Save credentials"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Store connection</CardTitle>
          <CardDescription>
            Status: {status}. Last sync {formatDate(config?.lastSyncAt ?? config?.last_sync_at, true)}.
            {config?.lastError || config?.last_error
              ? ` Latest error: ${config.lastError ?? config.last_error}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" disabled={!appConfigured || !form.shopDomain} onClick={connect}>
            Connect Shopify
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CopyField({
  id,
  label,
  value,
  onCopy,
  onChange,
  placeholder,
  readOnly = true,
}: {
  id: string;
  label: string;
  value: string;
  onCopy: () => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly={readOnly}
          placeholder={placeholder}
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        />
        <Button type="button" variant="secondary" disabled={!value} onClick={onCopy}>
          <Copy />
          Copy
        </Button>
      </div>
    </div>
  );
}
