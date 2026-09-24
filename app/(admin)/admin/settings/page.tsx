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

export default function AdminSettingsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "settings", "razorpay"],
    queryFn: () => api<RazorpaySettings>("/api/admin/settings/razorpay"),
  });
  const data = query.data;
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const resolvedKeyId = keyId || data?.keyId || "";

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

  async function copyWebhookUrl() {
    if (!data?.webhookUrl) return;
    await navigator.clipboard.writeText(data.webhookUrl);
    toast.success("Webhook URL copied.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="System settings"
        description="Connect Razorpay for subscription billing. Secrets are encrypted and never shown again."
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
