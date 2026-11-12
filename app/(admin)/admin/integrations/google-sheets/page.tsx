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
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/hooks/use-api";

type SheetsCrmDashboard = {
  enabled: boolean;
  webAppUrl: string;
  secretConfigured: boolean;
  secretMasked: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  syncedCount: number;
  failedCount: number;
  lastFullSyncAt: string | null;
  ready: boolean;
  status: "disabled" | "not_configured" | "error" | "connected";
  thresholds: {
    noWorkspaceHours: number;
    indiaPostHours: number;
    onboardingHours: number;
    inactiveDays: number;
  };
  stats: {
    signups: number;
    workspaces: number;
    active: number;
    abandoned: number;
    onboardingPending: number;
    pendingSync: number;
    successRate: number;
  };
};

type SyncLog = {
  id: string;
  event_id: string | null;
  event_type: string | null;
  customer_id: string | null;
  status: string;
  retry_count: number;
  error: string | null;
  created_at: string;
};

const STATUS_LABEL = {
  disabled: "Disabled",
  not_configured: "Not configured",
  error: "Needs attention",
  connected: "Connected",
} as const;

function formatWhen(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export default function AdminGoogleSheetsCrmPage() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin", "sheets-crm"],
    queryFn: () => api<SheetsCrmDashboard>("/api/admin/settings/sheets-crm"),
  });
  const logs = useQuery({
    queryKey: ["admin", "sheets-crm", "logs"],
    queryFn: () => api<{ logs: SyncLog[] }>("/api/admin/settings/sheets-crm/logs"),
  });
  const data = settings.data;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [webAppUrl, setWebAppUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [noWorkspaceHours, setNoWorkspaceHours] = useState("");
  const [indiaPostHours, setIndiaPostHours] = useState("");
  const [onboardingHours, setOnboardingHours] = useState("");
  const [inactiveDays, setInactiveDays] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api<SheetsCrmDashboard>("/api/admin/settings/sheets-crm", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: enabled ?? data?.enabled ?? false,
          webAppUrl: webAppUrl ?? data?.webAppUrl ?? "",
          secret: secret.trim() || undefined,
          noWorkspaceHours: Number(noWorkspaceHours || data?.thresholds.noWorkspaceHours || 24),
          indiaPostHours: Number(indiaPostHours || data?.thresholds.indiaPostHours || 24),
          onboardingHours: Number(onboardingHours || data?.thresholds.onboardingHours || 48),
          inactiveDays: Number(inactiveDays || data?.thresholds.inactiveDays || 7),
        }),
      }),
    onSuccess: () => {
      setSecret("");
      toast.success("Google Sheets CRM settings saved.");
      client.invalidateQueries({ queryKey: ["admin", "sheets-crm"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => api<SheetsCrmDashboard>("/api/admin/settings/sheets-crm/test", { method: "POST" }),
    onSuccess: () => {
      toast.success("Apps Script accepted the test.");
      client.invalidateQueries({ queryKey: ["admin", "sheets-crm"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncAll = useMutation({
    mutationFn: async () => {
      let cursor: string | null = null;
      let queued = 0;
      for (let page = 0; page < 40; page += 1) {
        const result: { queued: number; complete: boolean; cursor: string | null } = await api(
          "/api/admin/settings/sheets-crm/sync-all",
          { method: "POST", body: JSON.stringify({ cursor: cursor ?? undefined }) }
        );
        queued += result.queued;
        if (result.complete) return { queued };
        cursor = result.cursor;
      }
      return { queued };
    },
    onSuccess: (result) => {
      toast.success(`Queued ${result.queued} customers. The background sync will write them to Google Sheets.`);
      client.invalidateQueries({ queryKey: ["admin", "sheets-crm"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncFailed = useMutation({
    mutationFn: () => api<{ queued: number }>("/api/admin/settings/sheets-crm/sync-failed", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(`Queued ${result.queued} failed records.`);
      client.invalidateQueries({ queryKey: ["admin", "sheets-crm"] });
      client.invalidateQueries({ queryKey: ["admin", "sheets-crm", "logs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyScript = useMutation({
    mutationFn: () => api<{ source: string }>("/api/admin/settings/sheets-crm/script"),
    onSuccess: async (result) => {
      await navigator.clipboard.writeText(result.source);
      toast.success("Apps Script copied. Paste it into Extensions → Apps Script.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const status = data?.status ?? "not_configured";
  const stats = data?.stats;
  const loadError = settings.error instanceof Error ? settings.error.message : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Sheets CRM"
        description="Sync signups, workspaces, and onboarding to Google Sheets without slowing merchants down."
        actions={
          <Badge variant={status === "connected" ? "success" : status === "error" ? "error" : "warning"}>
            {STATUS_LABEL[status]}
          </Badge>
        }
      />

      {loadError ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Total signups" value={stats?.signups} />
        <Stat label="Total workspaces" value={stats?.workspaces} />
        <Stat label="Active clients" value={stats?.active} />
        <Stat label="Abandoned clients" value={stats?.abandoned} />
        <Stat label="Onboarding pending" value={stats?.onboardingPending} />
        <Stat label="Sync success rate" value={stats ? `${stats.successRate}%` : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div className="flex items-center justify-between gap-4 lg:col-span-2">
            <div>
              <Label htmlFor="sheets-crm-enabled">Enable synchronization</Label>
              <p className="text-sm text-muted">Turn this on only after the Apps Script Web App is deployed.</p>
            </div>
            <Switch
              id="sheets-crm-enabled"
              checked={enabled ?? data?.enabled ?? false}
              onCheckedChange={setEnabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheets-crm-url">Apps Script Web App URL</Label>
            <Input
              id="sheets-crm-url"
              value={webAppUrl ?? data?.webAppUrl ?? ""}
              placeholder="https://script.google.com/macros/s/…/exec"
              onChange={(event) => setWebAppUrl(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheets-crm-secret">Integration secret</Label>
            <Input
              id="sheets-crm-secret"
              type="password"
              value={secret}
              placeholder={data?.secretConfigured ? "Saved. Enter a new secret to replace it." : "At least 16 characters"}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="new-password"
            />
            <p className="text-sm text-muted">{data?.secretMasked ? `Current secret: ${data.secretMasked}` : "No secret saved."}</p>
          </div>
          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || settings.isLoading}>
              Save settings
            </Button>
            <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !data?.ready}>
              Test connection
            </Button>
            <Button variant="secondary" onClick={() => syncAll.mutate()} disabled={syncAll.isPending || !data?.ready}>
              Sync all existing customers
            </Button>
            <Button variant="secondary" onClick={() => syncFailed.mutate()} disabled={syncFailed.isPending || !data?.ready}>
              Sync failed records
            </Button>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:col-span-2">
            <div>
              <dt className="text-muted">Last successful sync</dt>
              <dd>{formatWhen(data?.lastSuccessAt ?? null)}</dd>
            </div>
            <div>
              <dt className="text-muted">Synchronized records</dt>
              <dd>{data?.syncedCount ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted">Failed records</dt>
              <dd>{data?.failedCount ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted">Waiting in queue</dt>
              <dd>{stats?.pendingSync ?? 0}</dd>
            </div>
          </dl>
          {data?.lastError ? <p className="text-sm text-red-700 lg:col-span-2">{data.lastError}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abandonment thresholds</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Threshold
            id="no-workspace-hours"
            label="No workspace (hours)"
            value={noWorkspaceHours || String(data?.thresholds.noWorkspaceHours ?? 24)}
            onChange={setNoWorkspaceHours}
          />
          <Threshold
            id="india-post-hours"
            label="India Post incomplete (hours)"
            value={indiaPostHours || String(data?.thresholds.indiaPostHours ?? 24)}
            onChange={setIndiaPostHours}
          />
          <Threshold
            id="onboarding-hours"
            label="Onboarding incomplete (hours)"
            value={onboardingHours || String(data?.thresholds.onboardingHours ?? 48)}
            onChange={setOnboardingHours}
          />
          <Threshold
            id="inactive-days"
            label="No activity (days)"
            value={inactiveDays || String(data?.thresholds.inactiveDays ?? 7)}
            onChange={setInactiveDays}
          />
          <p className="text-sm text-muted sm:col-span-2 xl:col-span-4">
            A customer leaves the abandoned list after they become active. Save settings to apply new thresholds. The billing schedule checks them in the background.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Apps Script deployment</CardTitle>
          <Button variant="secondary" onClick={() => copyScript.mutate()} disabled={copyScript.isPending}>
            Copy Apps Script
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted">
          <p>1. Create the CRM spreadsheet, then open Extensions → Apps Script and paste the copied script.</p>
          <p>2. Set script properties POSTBUS_CRM_SECRET and SPREADSHEET_ID. Use the same secret you save here.</p>
          <p>3. Deploy as a Web App, execute as you, and allow anyone to access it. Paste that URL above.</p>
          <p>The script creates All Signups, Workspaces, Abandoned Clients, Active Clients, and Sync Logs. It upserts by customer and workspace id.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent synchronization logs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Retries</th>
                <th className="py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {(logs.data?.logs ?? []).map((log) => (
                <tr key={log.id} className="border-t border-border">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(log.created_at)}</td>
                  <td className="py-2 pr-3">{log.event_type}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{log.customer_id}</td>
                  <td className="py-2 pr-3">{log.status}</td>
                  <td className="py-2 pr-3">{log.retry_count}</td>
                  <td className="py-2">{log.error}</td>
                </tr>
              ))}
              {!logs.data?.logs.length ? (
                <tr>
                  <td className="py-4 text-muted" colSpan={6}>
                    No synchronization logs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-ink">{value ?? "—"}</p>
      </CardContent>
    </Card>
  );
}

function Threshold({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={1} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
