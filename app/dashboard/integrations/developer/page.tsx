"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";

const SCOPES = [
  { id: "orders:read", label: "orders:read", hint: "List and get orders" },
  { id: "orders:write", label: "orders:write", hint: "Create and update orders (does not book)" },
  { id: "shipments:read", label: "shipments:read", hint: "List and get shipments" },
  { id: "shipments:book", label: "shipments:book", hint: "Request India Post booking" },
  { id: "tracking:read", label: "tracking:read", hint: "Read tracking events" },
  { id: "labels:read", label: "labels:read", hint: "Download shipping labels" },
] as const;

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  status: string;
  scopes?: string[];
  last_used_at?: string | null;
  created_at?: string;
  expires_at?: string | null;
};

type Usage = {
  total: number;
  successful: number;
  failed: number;
  recent: Array<{
    endpoint: string;
    method: string;
    response_status: number;
    duration_ms: number | null;
    created_at: string;
  }>;
};

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value);
  toast.success(`${label} copied.`);
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DeveloperPortalPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [name, setName] = useState("Google Apps Script");
  const [scopes, setScopes] = useState<string[]>(["orders:read"]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: ["merchant-api-keys"],
    queryFn: () => api<{ items: ApiKeyRow[] }>("/api/v1/api-keys"),
  });
  const usage = useQuery({
    queryKey: ["merchant-api-usage"],
    queryFn: () => api<Usage>("/api/v1/merchant-api/usage"),
  });
  const schema = useQuery({
    queryKey: ["merchant-api-schema"],
    queryFn: () => api<Record<string, unknown>>("/api/v1/merchant-api/schema"),
  });
  const prompt = useQuery({
    queryKey: ["merchant-api-ai-prompt"],
    queryFn: () => api<{ prompt: string }>("/api/v1/merchant-api/ai-prompt"),
  });
  const reference = useQuery({
    queryKey: ["merchant-api-docs-ref"],
    queryFn: () => api<{ content: string }>("/api/v1/merchant-api/docs?name=POSTBUS_API_REFERENCE.md"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<ApiKeyRow & { secret: string }>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name, scopes }),
      }),
    onSuccess: (data) => {
      setRevealed(data.secret);
      toast.success("API key created. Copy it now; it will not be shown again.");
      queryClient.invalidateQueries({ queryKey: ["merchant-api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api<ApiKeyRow & { secret: string }>(`/api/v1/api-keys/${id}/rotate`, { method: "POST" }),
    onSuccess: (data) => {
      setRevealed(data.secret);
      toast.success("API key rotated. Copy the new secret now.");
      queryClient.invalidateQueries({ queryKey: ["merchant-api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("API key revoked.");
      setRevokeId(null);
      queryClient.invalidateQueries({ queryKey: ["merchant-api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = keys.data?.items ?? [];
  const schemaJson = useMemo(() => JSON.stringify(schema.data ?? {}, null, 2), [schema.data]);

  function toggleScope(id: string) {
    setScopes((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function downloadDoc(name: string) {
    const doc = await api<{ content: string; name: string }>(`/api/v1/merchant-api/docs?name=${encodeURIComponent(name)}`);
    downloadText(doc.name, doc.content);
  }

  if (me.isSuccess && !me.data.merchantApi?.enabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Developer API" description="Merchant API is not enabled for this workspace." />
        <EmptyState icon={KeyRound} title="Not enabled" description="Ask PostBus to allowlist this organization before minting keys." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer API"
        description="Scoped keys, Merchant API v1 documentation, and AI-ready integration instructions."
      />

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="docs">Documentation</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="ai">AI integration</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API status</CardTitle>
              <CardDescription>Merchant API v1 is versioned at /api/merchant/v1. Dashboard /api/v1 stays session-only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Authenticate with <code className="rounded bg-surface-soft px-1">Authorization: Bearer pb_live_…</code>
              </p>
              <p>Create orders, then book India Post in a separate call. Creating an order does not book a shipment.</p>
              <p>Map Google Sheet columns in your script. PostBus does not store a sheet column mapper.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Create API key</CardTitle>
              <CardDescription>
                The full secret is shown once. Choose only the permissions this integration needs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {SCOPES.map((scope) => (
                  <label key={scope.id} className="flex items-start gap-2 text-sm">
                    <Checkbox checked={scopes.includes(scope.id)} onCheckedChange={() => toggleScope(scope.id)} />
                    <span>
                      <span className="font-medium">{scope.label}</span>
                      <span className="block text-muted">{scope.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Button disabled={!scopes.length || create.isPending} onClick={() => create.mutate()}>
                Generate API key
              </Button>
              {revealed ? (
                <div className="rounded-lg border border-border bg-surface-soft p-3">
                  <p className="mb-2 text-sm text-muted">Copy this secret now. It cannot be recovered later.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all text-sm">{revealed}</code>
                    <Button size="sm" variant="secondary" onClick={() => copyText(revealed, "API key")}>
                      <Copy className="size-4" />
                      Copy
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {keys.isLoading ? (
            <Skeleton className="h-40" />
          ) : items.length === 0 ? (
            <EmptyState icon={KeyRound} title="No API keys" description="Generate a scoped key to start integrating." />
          ) : (
            <div className="space-y-3">
              {items.map((key) => (
                <Card key={key.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{key.name}</CardTitle>
                    <CardDescription>
                      {key.key_prefix} · {key.status}
                      {key.scopes?.length ? ` · ${key.scopes.join(", ")}` : " · no Merchant API scopes"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                    <span>
                      Created {formatDate(key.created_at, true)} · Last used {formatDate(key.last_used_at, true)}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => rotate.mutate(key.id)}>
                        Rotate
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setRevokeId(key.id)}>
                        Revoke
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="docs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Downloads</CardTitle>
              <CardDescription>These files describe the public contract. They never include API secrets.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void downloadDoc("openapi.yaml")}>
                OpenAPI 3.1
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadDoc("POSTBUS_API_REFERENCE.md")}>
                API reference
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadDoc("POSTBUS_AI_INTEGRATION_GUIDE.md")}>
                AI guide
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadDoc("GOOGLE_APPS_SCRIPT_EXAMPLE.md")}>
                Apps Script example
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Field contract</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[28rem] overflow-auto rounded-lg bg-ink p-4 text-xs text-white">
                <code>{schemaJson}</code>
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>API reference</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm">
                {reference.data?.content ?? "Loading documentation…"}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          {usage.isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent requests</CardTitle>
                    <CardDescription>Last 100 in 7 days</CardDescription>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{usage.data?.total ?? 0}</CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Successful</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{usage.data?.successful ?? 0}</CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Failed</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-semibold">{usage.data?.failed ?? 0}</CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>Rate limits: 120 requests/minute per key, 30 booking posts/minute per key.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(usage.data?.recent ?? []).slice(0, 20).map((row, index) => (
                    <div key={`${row.created_at}-${index}`} className="flex justify-between gap-3">
                      <span>
                        {row.method} {row.endpoint}
                      </span>
                      <span className="text-muted">
                        {row.response_status} · {formatDate(row.created_at, true)}
                      </span>
                    </div>
                  ))}
                  {!usage.data?.recent?.length ? <p className="text-muted">No Merchant API traffic yet.</p> : null}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Build your integration with AI</CardTitle>
              <CardDescription>
                Copy this prompt into ChatGPT, Gemini, Claude, or Cursor together with the downloaded API docs. PostBus
                never sends your API key to an AI provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                size="sm"
                onClick={() => prompt.data?.prompt && copyText(prompt.data.prompt, "AI prompt")}
                disabled={!prompt.data?.prompt}
              >
                <Copy className="size-4" />
                Copy AI integration prompt
              </Button>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm">
                {prompt.data?.prompt ?? "Loading prompt…"}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(revokeId)} onOpenChange={(open) => !open && setRevokeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this API key?</DialogTitle>
            <DialogDescription>
              Scripts using this key will stop working immediately. You can create a replacement key.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRevokeId(null)}>
              Cancel
            </Button>
            <Button disabled={!revokeId || revoke.isPending} onClick={() => revokeId && revoke.mutate(revokeId)}>
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
