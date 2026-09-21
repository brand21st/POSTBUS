"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { asList, asPaginated } from "@/lib/dashboard/records";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { hasPermission } from "@/lib/permissions/rbac";
import { MEMBER_ROLES, WEBHOOK_EVENTS, type MemberRole } from "@/types/domain";
import type {
  ApiKeyRecord,
  AuditLogRecord,
  InviteRecord,
  MemberRecord,
  OrganizationSettings,
  WebhookRecord,
} from "@/types/api";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Organization, access, security, developer credentials, and audit history."
      />
      <Tabs defaultValue="organization" className="space-y-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="organization">
          <OrganizationSection />
        </TabsContent>
        <TabsContent value="members">
          <MembersSection />
        </TabsContent>
        <TabsContent value="roles">
          <RolesSection />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySection />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsSection />
        </TabsContent>
        <TabsContent value="api-keys">
          <ApiKeysSection />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksSection />
        </TabsContent>
        <TabsContent value="audit">
          <AuditSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrganizationSection() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canManage = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "org.manage");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["organization-settings"],
    queryFn: () => api<OrganizationSettings>("/api/v1/organizations"),
  });

  useEffect(() => {
    if (!query.data) return;
    setName(query.data.name ?? me.data?.organization?.name ?? "");
    setPhone(query.data.phone ?? "");
    setLine1(query.data.line1 ?? "");
    setLine2(query.data.line2 ?? "");
    setCity(query.data.city ?? "");
    setState(query.data.state ?? "");
    setPincode(query.data.pincode ?? "");
    if (!logoFile) {
      setLogoPreview(query.data.logoUrl ?? query.data.logo_url ?? null);
    }
  }, [query.data, me.data?.organization?.name, logoFile]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("name", name || query.data?.name || me.data?.organization?.name || "");
      body.append("phone", phone);
      body.append("line1", line1);
      body.append("line2", line2);
      body.append("city", city);
      body.append("state", state);
      body.append("pincode", pincode);
      if (logoFile) body.append("logo", logoFile);
      return api<OrganizationSettings>("/api/v1/organizations", {
        method: "PATCH",
        body,
      });
    },
    onSuccess: (data) => {
      toast.success("Organization updated. New labels will use this identity.");
      setLogoFile(null);
      setLogoPreview(data.logoUrl ?? data.logo_url ?? logoPreview);
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["organization-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          Name, address, phone, and logo printed as the sender on India Post shipping labels.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <Field label="Name">
          <Input disabled={!canManage} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Phone number">
          <Input
            disabled={!canManage}
            inputMode="tel"
            placeholder="9876543210"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field label="Address line 1">
          <Input disabled={!canManage} value={line1} onChange={(event) => setLine1(event.target.value)} />
        </Field>
        <Field label="Address line 2">
          <Input disabled={!canManage} value={line2} onChange={(event) => setLine2(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City">
            <Input disabled={!canManage} value={city} onChange={(event) => setCity(event.target.value)} />
          </Field>
          <Field label="State">
            <Input disabled={!canManage} value={state} onChange={(event) => setState(event.target.value)} />
          </Field>
        </div>
        <Field label="Pincode">
          <Input
            disabled={!canManage}
            inputMode="numeric"
            maxLength={6}
            placeholder="682311"
            value={pincode}
            onChange={(event) => setPincode(event.target.value)}
          />
        </Field>
        <Field label="Logo">
          {logoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPreview} alt="Organization logo" className="h-16 w-16 rounded-lg border border-border object-contain" />
          ) : null}
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!canManage}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setLogoFile(file);
              setLogoPreview(file ? URL.createObjectURL(file) : query.data?.logoUrl ?? query.data?.logo_url ?? null);
            }}
          />
        </Field>
        <Button type="button" onClick={() => mutation.mutate()} disabled={!canManage || mutation.isPending}>
          Save organization
        </Button>
      </CardContent>
    </Card>
  );
}

function MembersSection() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("OPERATOR");

  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => api<MemberRecord[] | { items: MemberRecord[] }>("/api/v1/members"),
  });
  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: () => api<InviteRecord[] | { items: InviteRecord[] }>("/api/v1/members/invites"),
  });

  const invite = useMutation({
    mutationFn: () =>
      api("/api/v1/members/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: () => {
      toast.success("Invite sent.");
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const memberRows = asList<MemberRecord>(members.data);
  const inviteRows = asList<InviteRecord>(invites.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite member</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <Input
            type="email"
            placeholder="colleague@store.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_ROLES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={() => invite.mutate()} disabled={!email || invite.isPending}>
            Invite
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.isError ? (
            <p className="text-sm text-error">{members.error.message}</p>
          ) : memberRows.length === 0 ? (
            <p className="text-sm text-muted">No members returned.</p>
          ) : (
            memberRows.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{member.fullName ?? member.full_name ?? member.email}</p>
                  <p className="text-xs text-muted">{member.email}</p>
                </div>
                <StatusBadge value={member.role} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {inviteRows.length === 0 ? (
            <p className="text-sm text-muted">No pending invites.</p>
          ) : (
            inviteRows.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <span className="text-sm">{item.email}</span>
                <StatusBadge value={item.role} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RolesSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>Permission map enforced by the API and RLS.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {[
          ["OWNER", "Full access including billing and ownership transfer."],
          ["ADMIN", "Manage members, settings, and operations. Billing-sensitive actions stay with owner."],
          ["MANAGER", "Orders, shipments, automation, and operational settings."],
          ["OPERATOR", "Create and process orders, shipments, labels, and manifests."],
          ["VIEWER", "Read-only access across the workspace."],
        ].map(([role, description]) => (
          <div key={role} className="rounded-xl border border-border px-4 py-3">
            <p className="font-medium">{role}</p>
            <p className="mt-1 text-muted">{description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SecuritySection() {
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password updated.");
      setPassword("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Session is cookie-based. Update your password here.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-md gap-4">
        <Field label="New password">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button
          type="button"
          disabled={password.length < 8 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Update password
        </Button>
      </CardContent>
    </Card>
  );
}

function NotificationsSection() {
  const queryClient = useQueryClient();
  const [emailAlerts, setEmailAlerts] = useState<boolean | null>(null);
  const [inApp, setInApp] = useState<boolean | null>(null);

  const query = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () =>
      api<{ emailAlerts?: boolean; inApp?: boolean }>("/api/v1/settings/notifications"),
  });
  const emailValue = emailAlerts ?? query.data?.emailAlerts ?? true;
  const inAppValue = inApp ?? query.data?.inApp ?? true;

  const mutation = useMutation({
    mutationFn: () =>
      api("/api/v1/settings/notifications", {
        method: "PATCH",
        body: JSON.stringify({ emailAlerts: emailValue, inApp: inAppValue }),
      }),
    onSuccess: () => {
      toast.success("Notification preferences saved.");
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose how this workspace alerts you about booking and job failures.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={emailValue}
            onCheckedChange={(value) => setEmailAlerts(value === true)}
          />
          Email alerts
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={inAppValue}
            onCheckedChange={(value) => setInApp(value === true)}
          />
          In-app notifications
        </label>
        <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          Save preferences
        </Button>
      </CardContent>
    </Card>
  );
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiKeyRecord[] | { items: ApiKeyRecord[] }>("/api/v1/api-keys"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<ApiKeyRecord>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (data) => {
      setRevealed(data.secret ?? null);
      setName("");
      toast.success("API key created. Copy the secret now — it will not be shown again.");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("API key revoked.");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const keys = asList<ApiKeyRecord>(query.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create API key</CardTitle>
          <CardDescription>The raw secret is shown once. Only the prefix is stored afterwards.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row">
          <Input placeholder="Production integration" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="button" disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Create key
          </Button>
        </CardContent>
      </Card>
      {revealed ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium">Copy this secret now</p>
            <p className="mt-2 break-all rounded-xl bg-surface px-3 py-2 font-mono text-sm">{revealed}</p>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.isError ? (
            <p className="text-sm text-error">{query.error.message}</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted">No API keys yet.</p>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{key.name}</p>
                  <p className="text-xs text-muted">
                    {key.keyPrefix ?? key.key_prefix} · last used {formatDate(key.lastUsedAt ?? key.last_used_at, true)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={key.status} />
                  <Button type="button" variant="secondary" size="sm" onClick={() => revoke.mutate(key.id)}>
                    Revoke
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WebhooksSection() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["shipment.booked"]);

  const query = useQuery({
    queryKey: ["webhooks"],
    queryFn: () => api<WebhookRecord[] | { items: WebhookRecord[] }>("/api/v1/webhooks"),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({ url, events }),
      }),
    onSuccess: () => {
      toast.success("Webhook endpoint created.");
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const endpoints = asList<WebhookRecord>(query.data);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Outgoing webhook</CardTitle>
          <CardDescription>Signed with HMAC, timestamp, and a replay window on the server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Endpoint URL">
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhooks/postbus" />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={events.includes(event)}
                  onCheckedChange={(checked) =>
                    setEvents((current) =>
                      checked === true ? [...current, event] : current.filter((item) => item !== event)
                    )
                  }
                />
                {event}
              </label>
            ))}
          </div>
          <Button type="button" disabled={!url || create.isPending} onClick={() => create.mutate()}>
            Add webhook
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.isError ? (
            <p className="text-sm text-error">{query.error.message}</p>
          ) : endpoints.length === 0 ? (
            <p className="text-sm text-muted">No webhook endpoints yet.</p>
          ) : (
            endpoints.map((endpoint) => (
              <div key={endpoint.id} className="rounded-xl border border-border px-4 py-3">
                <p className="text-sm font-medium">{endpoint.url}</p>
                <p className="mt-1 text-xs text-muted">{(endpoint.events ?? []).join(", ") || "No events"}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditSection() {
  const query = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => api<{ items?: AuditLogRecord[] }>("/api/v1/audit-logs"),
  });
  const logs = asPaginated<AuditLogRecord>(query.data, ["items"]).items;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit logs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isError ? (
          <p className="text-sm text-error">{query.error.message}</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted">No audit events yet.</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-border px-4 py-3 text-sm">
              <p className="font-medium">{log.action}</p>
              <p className="text-xs text-muted">
                {[log.entityType ?? log.entity_type, log.entityId ?? log.entity_id, formatDate(log.createdAt ?? log.created_at, true)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
