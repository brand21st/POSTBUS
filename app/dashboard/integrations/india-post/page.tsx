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
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    if (
      contracts.length ||
      config.pickupDropoffOfficeId ||
      config.pickup_dropoff_office_id ||
      config.barcodeRange?.prefix
    ) {
      setShowAdvanced(true);
    }
  }

  const filledContracts = form.contracts.filter((contract) => contract.contractId.trim());

  const save = useMutation({
    mutationFn: () => {
      const customerId = form.customerId.trim();
      if (productionBlocked) {
        throw new Error(
          "Production API URL is not set yet. Use UAT (sandbox) — CEPT must share the live base URL first."
        );
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
          // CEPT login username is the customer ID; booking also uses it as bulk_customer_id.
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
    onSuccess: () => toast.success("Test API call succeeded."),
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="India Post"
        description="Connect with your customer ID and password. Extra booking fields are optional until you ship."
        actions={<StatusBadge value={config?.status ?? "NOT_CONNECTED"} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Connect</CardTitle>
          <CardDescription>
            Login only needs customer ID and password.
            {config?.lastVerifiedAt || config?.last_verified_at
              ? ` Last verified ${formatDate(config?.lastVerifiedAt ?? config?.last_verified_at, true)}.`
              : ""}
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
                    {item === "UAT" ? "UAT (sandbox)" : "Production"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {productionBlocked ? (
              <p className="text-sm text-muted">
                Production is not available yet — CEPT has not shared the live API base URL.
                Keep <strong>UAT (sandbox)</strong> selected. Your customer ID and password work there.
              </p>
            ) : null}
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
              <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                Password saved encrypted.
                <button
                  type="button"
                  className="ml-2 font-medium text-brand hover:underline"
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

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-sm font-medium text-brand hover:underline"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          {showAdvanced ? "Hide optional booking settings" : "Show optional booking settings"}
        </button>
      </div>

      {showAdvanced ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Service contracts</CardTitle>
              <CardDescription>
                India Post issues a separate contract per product. Add the contract ID for
                each service you ship, and pick the one to use by default.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {INDIA_POST_SERVICES.map((service) => {
                const row = form.contracts.find((item) => item.serviceCode === service.code);
                const value = row?.contractId ?? "";
                return (
                  <div key={service.code} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <div className="space-y-1">
                      <Label>{service.label}</Label>
                      <p className="text-xs text-muted">{service.description}</p>
                    </div>
                    <Input
                      value={value}
                      placeholder="Contract ID, e.g. 41448820"
                      onChange={(event) => setContract(service.code, event.target.value)}
                    />
                    <Button
                      type="button"
                      variant={form.defaultServiceCode === service.code ? "primary" : "secondary"}
                      disabled={!value.trim()}
                      onClick={() => set("defaultServiceCode", service.code)}
                    >
                      {form.defaultServiceCode === service.code ? "Default" : "Make default"}
                    </Button>
                  </div>
                );
              })}
              <p className="text-sm text-muted">
                New shipments use the default service unless you pick another one when
                shipping. Leave a contract blank for services you do not ship.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pickup office</CardTitle>
              <CardDescription>
                Required for article booking. Leave blank if CEPT has not shared it yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field
                label="Pickup / drop-off office ID"
                value={form.pickupDropoffOfficeId}
                onChange={(value) => set("pickupDropoffOfficeId", value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Barcode range</CardTitle>
              <CardDescription>
                The article number series India Post allotted your contract. Enter the
                two-letter prefix and the 8-digit start/end serials. PostBus adds the
                S10 check digit, so CL 55697399 becomes CL556973995IN. Do not use the
                CEPT UAT range ET21433001–21434000 on production.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-4">
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
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save & connect"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
          Verify login
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
