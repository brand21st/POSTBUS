"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { MERCHANT_WEBHOOK_EVENTS } from "@/modules/webhooks/catalog";

const EVENTS = MERCHANT_WEBHOOK_EVENTS.filter((event) => event !== "webhook.test");

type Subscription = {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  needsSecretRotation?: boolean;
  secret?: string;
};

type Delivery = {
  id: string;
  event_id?: string | null;
  event: string;
  destination?: string | null;
  status: string;
  attempt_count: number;
  response_code?: number | null;
  last_error?: string | null;
  next_attempt_at?: string | null;
  created_at: string;
  endpoint_id?: string;
};

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value);
  toast.success(`${label} copied.`);
}

export function DeveloperWebhooksPanel() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([...EVENTS]);
  const [secret, setSecret] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["merchant-webhooks"],
    queryFn: () => api<{ items: Subscription[] }>("/api/v1/webhooks"),
  });
  const logs = useQuery({
    queryKey: ["merchant-webhook-logs"],
    queryFn: () => api<{ items: Delivery[] }>("/api/v1/webhooks/deliveries"),
  });
  const deliveries = useQuery({
    queryKey: ["merchant-webhook-deliveries", selectedId],
    queryFn: () => api<{ items: Delivery[] }>(`/api/v1/webhooks/${selectedId}/deliveries`),
    enabled: Boolean(selectedId),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Subscription>("/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({ url, events }),
      }),
    onSuccess: (data) => {
      setSecret(data.secret ?? null);
      setUrl("");
      toast.success("Webhook endpoint created.");
      queryClient.invalidateQueries({ queryKey: ["merchant-webhooks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api(`/api/v1/webhooks/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: input.enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchant-webhooks"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api<Subscription>(`/api/v1/webhooks/${id}/rotate-secret`, { method: "POST" }),
    onSuccess: (data) => {
      setSecret(data.secret ?? null);
      toast.success("Signing secret rotated. Copy it now.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: (id: string) => api(`/api/v1/webhooks/${id}/test`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Test event queued.");
      queryClient.invalidateQueries({ queryKey: ["merchant-webhook-logs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retry = useMutation({
    mutationFn: (input: { endpointId: string; deliveryId: string }) =>
      api(`/api/v1/webhooks/${input.endpointId}/deliveries/${input.deliveryId}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Delivery queued for retry.");
      queryClient.invalidateQueries({ queryKey: ["merchant-webhook-logs"] });
      queryClient.invalidateQueries({ queryKey: ["merchant-webhook-deliveries"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add webhook endpoint</CardTitle>
          <CardDescription>
            HTTPS URLs only. Private, loopback, and metadata hosts are rejected. The signing secret is shown once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">HTTPS URL</Label>
            <Input
              id="webhook-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://merchant.example.com/webhooks/postbus"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={events.includes(event)}
                  onCheckedChange={() =>
                    setEvents((current) =>
                      current.includes(event) ? current.filter((item) => item !== event) : [...current, event]
                    )
                  }
                />
                {event}
              </label>
            ))}
          </div>
          <Button disabled={!url || !events.length || create.isPending} onClick={() => create.mutate()}>
            Add endpoint
          </Button>
          {secret ? (
            <div className="rounded-lg border border-border bg-surface-soft p-3">
              <p className="mb-2 text-sm text-muted">Copy this signing secret now. It will not be shown again.</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all text-sm">{secret}</code>
                <Button size="sm" variant="secondary" onClick={() => copyText(secret, "Webhook secret")}>
                  Copy
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {list.isLoading ? (
        <Skeleton className="h-32" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No webhooks"
          description="Add a public HTTPS endpoint to receive shipment events."
        />
      ) : (
        items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="text-base">{item.url}</CardTitle>
              <CardDescription>
                {item.is_active ? "Active" : "Disabled"} · {item.events.join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: item.id, enabled: !item.is_active })}>
                {item.is_active ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => rotate.mutate(item.id)}>
                Rotate secret
              </Button>
              <Button size="sm" variant="secondary" onClick={() => test.mutate(item.id)}>
                Send test
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedId(item.id)}>
                Delivery history
              </Button>
            </CardContent>
          </Card>
        ))
      )}

      {selectedId ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(deliveries.data?.items ?? []).map((row) => (
              <div key={row.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {row.event} · {row.status} · {row.event_id}
                </span>
                {row.status === "FAILED" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => retry.mutate({ endpointId: selectedId, deliveryId: row.id })}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ))}
            {!deliveries.data?.items?.length ? <p className="text-muted">No deliveries for this endpoint.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Webhook logs</CardTitle>
          <CardDescription>Recent deliveries across endpoints. Secrets and query strings are not shown.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(logs.data?.items ?? []).map((row) => (
            <div key={row.id} className="flex justify-between gap-3">
              <span>
                {row.event} · {row.destination} · {row.status}
              </span>
              <span className="text-muted">
                {row.response_code ?? "—"} · attempts {row.attempt_count} · {formatDate(row.created_at, true)}
              </span>
            </div>
          ))}
          {!logs.data?.items?.length ? <p className="text-muted">No webhook deliveries yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
