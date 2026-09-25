"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IndiaPostLogo } from "@/components/brand/india-post-logo";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { IndiaPostOfficeFinder } from "@/components/integrations/india-post-office-finder";
import {
  DEFAULT_INDIA_POST_SERVICE,
  INDIA_POST_SERVICES,
  PROVIDER_ENVIRONMENTS,
} from "@/types/domain";
import type { IndiaPostConfig } from "@/types/api";

type ContractRow = { serviceCode: string; contractId: string };

type FormState = {
  environment: string;
  customerId: string;
  password: string;
  pickupDropoffOfficeId: string;
  contracts: ContractRow[];
  defaultServiceCode: string;
  rangeServiceCode: string;
  prefix: string;
  suffix: string;
  startNumber: string;
  endNumber: string;
};

const ANY_SERVICE = "ANY";

const EMPTY: FormState = {
  environment: "UAT",
  customerId: "",
  password: "",
  pickupDropoffOfficeId: "",
  contracts: [],
  defaultServiceCode: DEFAULT_INDIA_POST_SERVICE,
  rangeServiceCode: ANY_SERVICE,
  prefix: "",
  suffix: "IN",
  startNumber: "",
  endNumber: "",
};

export default function IndiaPostPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [replaceSecrets, setReplaceSecrets] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const query = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostConfig>("/api/v1/integrations/india-post"),
  });

  const config = query.data;
  const hasSecrets = Boolean(
    config?.hasPassword ?? config?.has_password ?? config?.usernameMasked ?? config?.username_masked
  );
  const prodConfigured = Boolean(config?.prodConfigured);
  const productionBlocked = form.environment === "PRODUCTION" && !prodConfigured;
  const lastError = config?.lastError || config?.last_error;
  const lastVerified = config?.lastVerifiedAt ?? config?.last_verified_at;

  if (config && !hydrated) {
    setHydrated(true);
    const legacyContract = String(config.contractId ?? config.contract_id ?? "");
    const contracts: ContractRow[] = config.contracts?.length
      ? config.contracts.map((contract) => ({
          serviceCode: contract.serviceCode,
          contractId: contract.contractId,
        }))
      : legacyContract
        ? [{ serviceCode: DEFAULT_INDIA_POST_SERVICE, contractId: legacyContract }]
        : [];

    setForm((current) => ({
      ...current,
      environment: config.environment ?? "UAT",
      customerId: String(config.bulkCustomerId ?? config.bulk_customer_id ?? ""),
      pickupDropoffOfficeId: String(
        config.pickupDropoffOfficeId ?? config.pickup_dropoff_office_id ?? ""
      ),
      contracts,
      defaultServiceCode: config.defaultServiceCode ?? DEFAULT_INDIA_POST_SERVICE,
      rangeServiceCode: config.barcodeRange?.serviceCode ?? ANY_SERVICE,
      prefix: String(config.barcodeRange?.prefix ?? ""),
      suffix: String(config.barcodeRange?.suffix ?? "IN"),
      startNumber: config.barcodeRange?.startNumber != null ? String(config.barcodeRange.startNumber) : "",
      endNumber: config.barcodeRange?.endNumber != null ? String(config.barcodeRange.endNumber) : "",
    }));
  }

  const filledContracts = form.contracts.filter((contract) => contract.contractId.trim());

  const save = useMutation({
    mutationFn: () => {
      const customerId = form.customerId.trim();
      if (productionBlocked) {
        throw new Error("Live booking is not ready yet. Keep Test selected.");
      }
      if (!customerId && !hasSecrets) {
        throw new Error("Enter your India Post customer ID.");
      }
      if (!hasSecrets && !form.password.trim()) {
        throw new Error("Enter your India Post password.");
      }
      return api<IndiaPostConfig>("/api/v1/integrations/india-post", {
        method: "POST",
        body: JSON.stringify({
          environment: form.environment,
          username: replaceSecrets || !hasSecrets ? customerId || undefined : undefined,
          password: replaceSecrets || !hasSecrets ? form.password || undefined : undefined,
          bulkCustomerId: customerId || undefined,
          pickupDropoffOfficeId: form.pickupDropoffOfficeId.trim() || undefined,
          contracts: filledContracts.length
            ? filledContracts.map((contract) => ({
                serviceCode: contract.serviceCode,
                contractId: contract.contractId.trim(),
                isDefault: contract.serviceCode === form.defaultServiceCode,
              }))
            : undefined,
          barcodeRange: form.prefix.trim()
            ? {
                prefix: form.prefix.trim(),
                suffix: form.suffix.trim() || "IN",
                startNumber: Number(form.startNumber),
                endNumber: Number(form.endNumber),
                serviceCode:
                  form.rangeServiceCode === ANY_SERVICE ? null : form.rangeServiceCode,
              }
            : undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success("India Post connected. Status is Connected.");
      setForm((current) => ({ ...current, password: "" }));
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
    onSuccess: () => toast.success("India Post confirmed the connection."),
    onError: (error: Error) => toast.error(error.message),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setContract(serviceCode: string, contractId: string) {
    setForm((current) => {
      const contracts = current.contracts.some((item) => item.serviceCode === serviceCode)
        ? current.contracts.map((item) =>
            item.serviceCode === serviceCode ? { ...item, contractId } : item
          )
        : [...current.contracts, { serviceCode, contractId }];
      return { ...current, contracts };
    });
  }

  const bookingWebhook = config?.bookingWebhookUrl ?? config?.booking_webhook_url ?? "";
  const eventsWebhook = config?.eventsWebhookUrl ?? config?.events_webhook_url ?? "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={<IndiaPostLogo className="h-12 max-w-[12rem]" />}
        description="Sign in with your India Post customer ID and password, then add your post office and barcode series."
        actions={<StatusBadge value={config?.status ?? "NOT_CONNECTED"} />}
      />

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Use the customer ID and password from your India Post booking account. Your password is saved securely.
            {lastVerified ? ` Last checked ${formatDate(lastVerified, true)}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label>Account</Label>
            <Select value={form.environment} onValueChange={(value) => set("environment", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ENVIRONMENTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "UAT" ? "Test" : "Live"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            label="Customer ID"
            value={form.customerId}
            onChange={(value) => set("customerId", value)}
            autoComplete="off"
            placeholder="e.g. 1788590988"
          />
          {hasSecrets && !replaceSecrets ? (
            <div className="space-y-2">
              <Label>Password</Label>
              <div className="flex h-11 items-center justify-between gap-3 rounded-[var(--radius-btn)] border border-border bg-surface px-3 text-sm text-muted">
                Saved securely
                <button
                  type="button"
                  className="shrink-0 font-medium text-brand hover:underline"
                  onClick={() => setReplaceSecrets(true)}
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={(value) => set("password", value)}
              autoComplete="new-password"
            />
          )}
          {productionBlocked ? (
            <p className="text-sm text-muted sm:col-span-2 xl:col-span-3">
              Live booking is not ready yet. Keep <strong>Test</strong> selected.
            </p>
          ) : null}
          {lastError ? (
            <p className="rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-sm text-error sm:col-span-2 xl:col-span-3">
              {lastError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save & connect"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? "Verifying…" : "Verify login"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending ? "Checking…" : "Test connection"}
          </Button>
        </CardFooter>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Drop-off office</CardTitle>
            <CardDescription className="mt-1">
              The post office where you hand over parcels. Search by pincode or enter the 8-digit office ID.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Office ID"
              value={form.pickupDropoffOfficeId}
              placeholder="22660454"
              onChange={(value) => set("pickupDropoffOfficeId", value.replace(/\D/g, "").slice(0, 8))}
            />
            <IndiaPostOfficeFinder
              officeId={form.pickupDropoffOfficeId}
              onOfficeIdChange={(value) => set("pickupDropoffOfficeId", value)}
              canSearch={Boolean(form.customerId && (hasSecrets || form.password))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Barcode range</CardTitle>
            <CardDescription className="mt-1">
              The article number series from your India Post allotment. We add the check digit — for example CL 55697399 becomes CL556973995IN.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Series applies to</Label>
              <Select
                value={form.rangeServiceCode}
                onValueChange={(value) => set("rangeServiceCode", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SERVICE}>Any service</SelectItem>
                  {INDIA_POST_SERVICES.map((service) => (
                    <SelectItem key={service.code} value={service.code}>
                      {service.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              label="Prefix"
              value={form.prefix}
              placeholder="CL"
              onChange={(value) => set("prefix", value)}
            />
            <Field label="Suffix" value={form.suffix} onChange={(value) => set("suffix", value)} />
            <Field
              label="Start number"
              value={form.startNumber}
              onChange={(value) => set("startNumber", value)}
            />
            <Field
              label="End number"
              value={form.endNumber}
              onChange={(value) => set("endNumber", value)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Service contracts</CardTitle>
          <CardDescription>
            One contract number per service you ship. Leave unused rows blank. New shipments use the default.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border border-t border-border">
            {INDIA_POST_SERVICES.map((service) => {
              const row = form.contracts.find((item) => item.serviceCode === service.code);
              const value = row?.contractId ?? "";
              const isDefault = form.defaultServiceCode === service.code;
              return (
                <div
                  key={service.code}
                  className="grid gap-3 px-6 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{service.label}</p>
                    <p className="truncate text-xs text-muted">{service.description}</p>
                  </div>
                  <Input
                    value={value}
                    placeholder="Contract ID"
                    onChange={(event) => setContract(service.code, event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={isDefault ? "primary" : "secondary"}
                    disabled={!value.trim()}
                    onClick={() => set("defaultServiceCode", service.code)}
                  >
                    {isDefault ? "Default" : "Set default"}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {bookingWebhook || eventsWebhook ? (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle>Tracking updates</CardTitle>
            <CardDescription>
              Paste these links in your India Post portal so booking and tracking updates come back to PostBus.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-2">
            <CopyField id="booking-webhook" label="After booking" value={bookingWebhook} />
            <CopyField id="events-webhook" label="Tracking changes" value={eventsWebhook} />
          </CardContent>
        </Card>
      ) : null}
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
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-11"
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
