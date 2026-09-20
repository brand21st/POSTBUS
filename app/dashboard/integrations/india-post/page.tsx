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
import { PROVIDER_ENVIRONMENTS } from "@/types/domain";
import type { IndiaPostConfig } from "@/types/api";

type FormState = {
  environment: string;
  username: string;
  password: string;
  bulkCustomerId: string;
  contractId: string;
  pickupDropoffOfficeId: string;
  prefix: string;
  suffix: string;
  startNumber: string;
  endNumber: string;
};

const EMPTY: FormState = {
  environment: "UAT",
  username: "",
  password: "",
  bulkCustomerId: "",
  contractId: "",
  pickupDropoffOfficeId: "",
  prefix: "",
  suffix: "IN",
  startNumber: "",
  endNumber: "",
};

export default function IndiaPostPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [replaceSecrets, setReplaceSecrets] = useState(false);

  const query = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostConfig>("/api/v1/integrations/india-post"),
    select: (data) => data,
  });

  const config = query.data;
  const hasSecrets = Boolean(config?.hasPassword ?? config?.has_password ?? config?.usernameMasked ?? config?.username_masked);

  const save = useMutation({
    mutationFn: () =>
      api<IndiaPostConfig>("/api/v1/integrations/india-post", {
        method: "POST",
        body: JSON.stringify({
          environment: form.environment,
          username: form.username || undefined,
          password: form.password || undefined,
          bulkCustomerId: form.bulkCustomerId,
          contractId: form.contractId,
          pickupDropoffOfficeId: form.pickupDropoffOfficeId,
          barcodeRange: form.prefix
            ? {
                prefix: form.prefix,
                suffix: form.suffix,
                startNumber: Number(form.startNumber),
                endNumber: Number(form.endNumber),
              }
            : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("India Post settings saved. Secrets are stored encrypted.");
      setForm((current) => ({ ...current, username: "", password: "" }));
      setReplaceSecrets(false);
      queryClient.invalidateQueries({ queryKey: ["india-post"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const verify = useMutation({
    mutationFn: () => api("/api/v1/integrations/india-post/verify", { method: "POST" }),
    onSuccess: () => toast.success("Connection verified against India Post."),
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: () => api("/api/v1/integrations/india-post/test", { method: "POST" }),
    onSuccess: () => toast.success("Test API call succeeded."),
    onError: (error: Error) => toast.error(error.message),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="India Post"
        description="UAT or production credentials are encrypted at rest. After save, secrets are never shown again."
        actions={<StatusBadge value={config?.status ?? "NOT_CONNECTED"} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Last verified {formatDate(config?.lastVerifiedAt ?? config?.last_verified_at, true)}.
            {config?.lastError || config?.last_error
              ? ` Latest error: ${config.lastError ?? config.last_error}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Environment</Label>
            <Select value={form.environment} onValueChange={(value) => set("environment", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ENVIRONMENTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            label="Bulk customer ID"
            value={form.bulkCustomerId || (config?.bulkCustomerId ?? config?.bulk_customer_id ?? "")}
            onChange={(value) => set("bulkCustomerId", value)}
          />
          <Field
            label="Contract ID"
            value={form.contractId || (config?.contractId ?? config?.contract_id ?? "")}
            onChange={(value) => set("contractId", value)}
          />
          <Field
            label="Pickup / drop-off office ID"
            value={
              form.pickupDropoffOfficeId ||
              (config?.pickupDropoffOfficeId ?? config?.pickup_dropoff_office_id ?? "")
            }
            onChange={(value) => set("pickupDropoffOfficeId", value)}
          />

          {hasSecrets && !replaceSecrets ? (
            <div className="col-span-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
              Username {config?.usernameMasked ?? config?.username_masked ?? "••••"} · password saved.
              <button
                type="button"
                className="ml-2 font-medium text-brand hover:underline"
                onClick={() => setReplaceSecrets(true)}
              >
                Replace credentials
              </button>
            </div>
          ) : (
            <>
              <Field
                label="Username"
                value={form.username}
                onChange={(value) => set("username", value)}
                autoComplete="off"
              />
              <Field
                label="Password"
                type="password"
                value={form.password}
                onChange={(value) => set("password", value)}
                autoComplete="new-password"
              />
            </>
          )}
        </CardContent>
      </Card>

      {(config?.bookingWebhookUrl || config?.booking_webhook_url) && (
        <Card>
          <CardHeader>
            <CardTitle>India Post event webhooks</CardTitle>
            <CardDescription>
              Paste these into the India Post portal Event Configuration. Environment:{" "}
              <StatusBadge value={config?.environment ?? "UAT"} />. Authentication is not
              documented by CEPT yet — the connection id in the path identifies this workspace.
              Use the portal Test buttons after deploy. Do not paste secrets here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <CopyField
              id="booking-webhook"
              label="Booking Events Webhook URL"
              value={config?.bookingWebhookUrl ?? config?.booking_webhook_url ?? ""}
            />
            <CopyField
              id="events-webhook"
              label="Other Events Webhook URL"
              value={config?.eventsWebhookUrl ?? config?.events_webhook_url ?? ""}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Barcode range</CardTitle>
          <CardDescription>Used to allocate unique India Post barcodes for this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Field label="Prefix" value={form.prefix} onChange={(value) => set("prefix", value)} />
          <Field label="Suffix" value={form.suffix} onChange={(value) => set("suffix", value)} />
          <Field label="Start number" value={form.startNumber} onChange={(value) => set("startNumber", value)} />
          <Field label="End number" value={form.endNumber} onChange={(value) => set("endNumber", value)} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save configuration"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
          Verify
        </Button>
        <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
          Test API
        </Button>
      </div>
    </div>
  );
}

function CopyField({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} />
        <Button
          type="button"
          variant="secondary"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied.`);
          }}
        >
          <Copy />
          Copy
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
