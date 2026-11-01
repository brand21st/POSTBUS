"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";
import { formatDate } from "@/lib/format";
import type { IndiaPostWebhookHealth } from "@/modules/india-post/webhook-health";

export default function AdminIndiaPostWebhooksPage() {
  const query = useQuery({
    queryKey: ["admin", "india-post-webhooks"],
    queryFn: () => api<IndiaPostWebhookHealth>("/api/admin/india-post/webhooks"),
  });
  const health = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="India Post webhooks"
        description="Read-only ingest health. HTTP callbacks stay quarantined until CEPT documents a sender authenticator."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>HTTP ingest</CardDescription>
            <CardTitle>{health?.ingestQuarantined ? "Quarantined" : "Open"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sender authentication</CardDescription>
            <CardTitle>{health?.senderAuthentication ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Inbox processed</CardDescription>
            <CardTitle>{health?.inbox.processed ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Failed jobs (24h)</CardDescription>
            <CardTitle>{health?.jobs.failedLast24h ?? "—"}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Production callbacks</CardTitle>
          <CardDescription>Register these URLs with CEPT. Do not use apex postbus.in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          <p>{health?.productionCallbacks.eventsWebhookUrl}</p>
          <p>{health?.productionCallbacks.bookingWebhookUrl}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Inbox timestamps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Last received: {health?.inbox.lastReceivedAt ? formatDate(health.inbox.lastReceivedAt, true) : "none"}</p>
          <p>Last processed: {health?.inbox.lastProcessedAt ? formatDate(health.inbox.lastProcessedAt, true) : "none"}</p>
          <p>Last failed: {health?.inbox.lastFailedAt ? formatDate(health.inbox.lastFailedAt, true) : "none"}</p>
          <p>Last job failure code: {health?.jobs.lastFailureCode ?? "none"}</p>
        </CardContent>
      </Card>
    </div>
  );
}
