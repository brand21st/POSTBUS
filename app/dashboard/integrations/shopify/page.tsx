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
  apiKey: string;
  apiSecret: string;
};

const EMPTY: FormState = {
  shopDomain: "",
  apiKey: "",
  apiSecret: "",
};

export default function ShopifyIntegrationPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [replaceSecrets, setReplaceSecrets] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const query = useQuery({
    queryKey: ["shopify"],
    queryFn: () => api<ShopifyConfig>("/api/v1/integrations/shopify"),
  });
  const config = query.data;
  const hasSecrets = Boolean(config?.hasApiKey ?? config?.has_api_key) && Boolean(config?.hasApiSecret ?? config?.has_api_secret);
  const scopes = config?.requestedScopes ?? config?.requested_scopes ?? "";
  const webhookUrl = config?.webhookUrl ?? config?.webhook_url ?? "";
  const appConfigured = Boolean(config?.appConfigured);
  const status = config?.status ?? "NOT_CONNECTED";

  useEffect(() => {
    if (!config || hydrated) return;
    setForm({
      shopDomain: config.shopDomain ?? config.shop_domain ?? "",
      apiKey: "",
      apiSecret: "",
    });
    setHydrated(true);
  }, [config, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      api<ShopifyConfig>("/api/v1/integrations/shopify", {
        method: "POST",
        body: JSON.stringify({
          shopDomain: form.shopDomain,
          apiKey: form.apiKey || undefined,
          apiSecret: form.apiSecret || undefined,
          requestedScopes: scopes || undefined,
        }),
      }),
    onSuccess: (data) => {
      toast.success("Shopify credentials saved. Secrets are stored encrypted.");
      setForm({
        shopDomain: data.shopDomain ?? data.shop_domain ?? form.shopDomain,
        apiKey: "",
        apiSecret: "",
      });
      setReplaceSecrets(false);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shopify"
        description="Save this store’s custom app credentials. After save, secrets are never shown again."
        actions={<StatusBadge value={status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>App credentials</CardTitle>
          <CardDescription>
            Use the Client ID, Client secret, and scopes from your Shopify custom app. Paste the webhook URL into the app’s webhook settings.
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

          {hasSecrets && !replaceSecrets ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
              API key {config?.apiKeyMasked ?? config?.api_key_masked ?? "••••"} · app secret saved.
              <button
                type="button"
                className="ml-2 font-medium text-brand hover:underline"
                onClick={() => setReplaceSecrets(true)}
              >
                Replace credentials
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="apiKey">App API key</Label>
                <Input
                  id="apiKey"
                  autoComplete="off"
                  value={form.apiKey}
                  onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiSecret">App secret</Label>
                <Input
                  id="apiSecret"
                  type="password"
                  autoComplete="new-password"
                  value={form.apiSecret}
                  onChange={(event) => setForm((current) => ({ ...current, apiSecret: event.target.value }))}
                />
              </div>
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
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !form.shopDomain}>
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
}: {
  id: string;
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} />
        <Button type="button" variant="secondary" disabled={!value} onClick={onCopy}>
          <Copy />
          Copy
        </Button>
      </div>
    </div>
  );
}
