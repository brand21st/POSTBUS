"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage, useShopifyApi } from "@/components/shopify-app/api";
import { showToast } from "@/components/shopify-app/app-bridge";
import { bookableServices } from "@/components/shopify-app/booking";
import { formatDate, positiveNumber, SERVICE_OPTIONS } from "@/components/shopify-app/format";
import type { AutomationSettings, IndiaPostSettings } from "@/components/shopify-app/types";
import { ErrorBanner, SectionSkeleton, StatusBadge } from "@/components/shopify-app/ui";

type Office = {
  officeId: string;
  name: string;
  pincode: string;
  city?: string;
  state?: string;
  officeTypeCode?: string;
};

const AUTOMATION_SWITCHES: Array<{ key: keyof AutomationSettings; label: string; details: string }> = [
  {
    key: "autoShopifySync",
    label: "Import new Shopify orders",
    details: "New and updated orders appear in PostBus automatically.",
  },
  {
    key: "autoShopifyFulfillment",
    label: "Fulfill orders in Shopify with tracking",
    details: "When India Post accepts a parcel, PostBus marks the order fulfilled and adds the tracking number.",
  },
  {
    key: "autoTrackingSync",
    label: "Update tracking automatically",
    details: "PostBus checks India Post for new scans and keeps statuses current.",
  },
  {
    key: "autoBooking",
    label: "Book new orders automatically",
    details: "Every new order is booked with India Post using your defaults. India Post charges apply per booking.",
  },
];

function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <s-section heading={heading}>
      <div id={id}>{children}</div>
    </s-section>
  );
}

export function ShopifySettingsPage() {
  const api = useShopifyApi();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostSettings>("integrations/india-post"),
  });
  const automation = useQuery({
    queryKey: ["automation"],
    queryFn: () => api<AutomationSettings>("automation"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["india-post"] });

  // Home links straight to #contract / #parcel; scroll there once the sections exist.
  useEffect(() => {
    if (!settings.data || typeof window === "undefined" || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [settings.data]);

  if (settings.isError) {
    return (
      <s-page heading="Settings">
        <ErrorBanner heading="Couldn't load settings" error={settings.error} onRetry={() => settings.refetch()} />
      </s-page>
    );
  }

  if (!settings.data) {
    return (
      <s-page heading="Settings">
        <SectionSkeleton heading="India Post account" lines={4} />
        <SectionSkeleton heading="Contracts" lines={3} />
        <SectionSkeleton heading="Default parcel" lines={2} />
      </s-page>
    );
  }

  const data = settings.data;
  const connected = String(data.status).toUpperCase() === "CONNECTED";

  return (
    <s-page heading="Settings">
      <AccountSection settings={data} connected={connected} onSaved={refresh} />
      <ContractsSection settings={data} disabled={!data.hasPassword} onSaved={refresh} />
      <PickupSection settings={data} disabled={!data.hasPassword} onSaved={refresh} />
      <ParcelSection settings={data} onSaved={refresh} />
      <Section id="automation" heading="Automation">
        {automation.isError ? (
          <ErrorBanner heading="Couldn't load automation" error={automation.error} onRetry={() => automation.refetch()} />
        ) : (
          <AutomationSwitches value={automation.data} />
        )}
      </Section>
    </s-page>
  );
}

function AccountSection({ settings, connected, onSaved }: { settings: IndiaPostSettings; connected: boolean; onSaved: () => void }) {
  const api = useShopifyApi();
  const [customerId, setCustomerId] = useState(settings.bulkCustomerId ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await api("integrations/india-post", {
        method: "POST",
        body: {
          bulkCustomerId: customerId.trim(),
          ...(username.trim() ? { username: username.trim() } : {}),
          ...(password ? { password } : {}),
        },
      });
      await api("integrations/india-post/verify", { method: "POST", body: {} });
    },
    onSuccess: () => {
      setPassword("");
      setError(null);
      showToast("India Post connected");
      onSaved();
    },
    onError: (caught) => {
      setError(errorMessage(caught, "India Post didn't accept these details."));
      onSaved();
    },
  });

  function submit() {
    if (!customerId.trim()) return setError("Enter your India Post bulk customer ID.");
    if (!settings.hasPassword && (!username.trim() || !password)) {
      return setError("Enter the India Post username and password for this customer ID.");
    }
    save.mutate();
  }

  return (
    <Section id="account" heading="India Post account">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <StatusBadge label={connected ? "Connected" : "Not connected"} tone={connected ? "success" : "warning"} />
          {settings.lastVerifiedAt ? <s-text color="subdued">{`Verified ${formatDate(settings.lastVerifiedAt)}`}</s-text> : null}
        </s-stack>
        {!connected && settings.lastError ? <s-banner tone="critical">{settings.lastError}</s-banner> : null}
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        <s-text-field
          label="Bulk customer ID"
          details="The customer ID India Post gave you for bulk booking."
          value={customerId}
          onInput={(event) => setCustomerId(event.currentTarget.value)}
        />
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <s-text-field
            label="Username"
            autocomplete="off"
            placeholder={settings.hasPassword ? "Saved — leave blank to keep" : ""}
            value={username}
            onInput={(event) => setUsername(event.currentTarget.value)}
          />
          <s-password-field
            label="Password"
            autocomplete="new-password"
            placeholder={settings.hasPassword ? "Saved — leave blank to keep" : ""}
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </s-grid>
        <s-stack direction="inline" justifyContent="end">
          <s-button variant="primary" loading={save.isPending} onClick={submit}>
            {connected ? "Save and re-verify" : "Connect India Post"}
          </s-button>
        </s-stack>
      </s-stack>
    </Section>
  );
}

function ContractsSection({ settings, disabled, onSaved }: { settings: IndiaPostSettings; disabled: boolean; onSaved: () => void }) {
  const api = useShopifyApi();
  const initial = Object.fromEntries(
    SERVICE_OPTIONS.map((option) => [
      option.code,
      settings.contracts.find((contract) => contract.serviceCode === option.code)?.contractId ?? "",
    ])
  ) as Record<string, string>;
  const [contracts, setContracts] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const saveContract = useMutation({
    mutationFn: (serviceCode: string) =>
      api("integrations/india-post/contracts", {
        method: "PATCH",
        body: { serviceCode, contractId: contracts[serviceCode] ?? "" },
      }),
    onSuccess: () => {
      setError(null);
      showToast("Contract saved");
      onSaved();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const setDefault = useMutation({
    mutationFn: (serviceCode: string) =>
      api("integrations/india-post/default-service", { method: "PATCH", body: { serviceCode } }),
    onSuccess: () => {
      showToast("Default service updated");
      onSaved();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const available = bookableServices(settings);

  return (
    <Section id="contract" heading="Contracts">
      <s-stack gap="base">
        <s-paragraph color="subdued">Add the contract ID for each India Post service you use. You need at least one.</s-paragraph>
        {disabled ? <s-banner tone="info">Connect your India Post account first.</s-banner> : null}
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {SERVICE_OPTIONS.map((option) => (
          <s-stack key={option.code} direction="inline" gap="base" alignItems="end">
            <s-box inlineSize="100%">
              <s-text-field
                label={`${option.label} contract ID`}
                disabled={disabled}
                value={contracts[option.code] ?? ""}
                onInput={(event) => {
                  const value = event.currentTarget.value.replace(/\D/g, "");
                  setContracts((current) => ({ ...current, [option.code]: value }));
                }}
              />
            </s-box>
            <s-button
              disabled={disabled || (contracts[option.code] ?? "") === (initial[option.code] ?? "")}
              loading={saveContract.isPending && saveContract.variables === option.code}
              onClick={() => saveContract.mutate(option.code)}
            >
              Save
            </s-button>
          </s-stack>
        ))}
        {available.length > 1 ? (
          <s-select
            label="Default service"
            value={settings.defaultServiceCode}
            onChange={(event) => setDefault.mutate(event.currentTarget.value)}
          >
            {available.map((option) => (
              <s-option key={option.code} value={option.code}>
                {option.label}
              </s-option>
            ))}
          </s-select>
        ) : null}
      </s-stack>
    </Section>
  );
}

function PickupSection({ settings, disabled, onSaved }: { settings: IndiaPostSettings; disabled: boolean; onSaved: () => void }) {
  const api = useShopifyApi();
  const [pincode, setPincode] = useState(settings.pickupOfficePincode ?? "");
  const [officeId, setOfficeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const offices = useMutation({
    mutationFn: (pin: string) => api<{ offices: Office[] }>(`integrations/india-post/offices?pincode=${pin}`),
    onSuccess: (result) => {
      setError(null);
      setOfficeId(result.offices[0]?.officeId ?? "");
      if (!result.offices.length) setError("India Post has no booking office for this PIN code.");
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const save = useMutation({
    mutationFn: (office: Office) =>
      api("integrations/india-post/pickup-office", {
        method: "PATCH",
        body: {
          pickupOfficeId: office.officeId,
          pickupOfficeName: office.name,
          pickupOfficePincode: office.pincode,
          pickupOfficeTypeCode: office.officeTypeCode ?? null,
          pickupOfficeCity: office.city ?? null,
          pickupOfficeState: office.state ?? null,
        },
      }),
    onSuccess: () => {
      showToast("Pickup office saved");
      onSaved();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const list = offices.data?.offices ?? [];
  const chosen = list.find((office) => office.officeId === officeId);

  return (
    <Section id="pickup" heading="Pickup post office">
      <s-stack gap="base">
        <s-paragraph color="subdued">
          {settings.pickupOfficeName
            ? `Parcels are handed over at ${settings.pickupOfficeName} (${settings.pickupOfficePincode ?? ""}).`
            : "Choose the post office where you hand over parcels."}
        </s-paragraph>
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-box inlineSize="100%">
            <s-text-field
              label="PIN code of your post office"
              disabled={disabled}
              value={pincode}
              onInput={(event) => setPincode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            />
          </s-box>
          <s-button
            disabled={disabled || pincode.length !== 6}
            loading={offices.isPending}
            onClick={() => offices.mutate(pincode)}
          >
            Find offices
          </s-button>
        </s-stack>
        {list.length ? (
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-box inlineSize="100%">
              <s-select label="Post office" value={officeId} onChange={(event) => setOfficeId(event.currentTarget.value)}>
                {list.map((office) => (
                  <s-option key={office.officeId} value={office.officeId}>
                    {`${office.name}${office.city ? `, ${office.city}` : ""}`}
                  </s-option>
                ))}
              </s-select>
            </s-box>
            <s-button variant="primary" disabled={!chosen} loading={save.isPending} onClick={() => chosen && save.mutate(chosen)}>
              Save office
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>
    </Section>
  );
}

function ParcelSection({ settings, onSaved }: { settings: IndiaPostSettings; onSaved: () => void }) {
  const api = useShopifyApi();
  const asText = (value: number | null) => (value == null ? "" : String(value));
  const [form, setForm] = useState({
    weightGrams: asText(settings.defaultWeightGrams),
    lengthCm: asText(settings.defaultLengthCm),
    widthCm: asText(settings.defaultWidthCm),
    heightCm: asText(settings.defaultHeightCm),
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api("integrations/india-post/parcel-defaults", {
        method: "PATCH",
        body: {
          weightGrams: positiveNumber(form.weightGrams),
          lengthCm: positiveNumber(form.lengthCm),
          widthCm: positiveNumber(form.widthCm),
          heightCm: positiveNumber(form.heightCm),
        },
      }),
    onSuccess: () => {
      setError(null);
      showToast("Default parcel saved");
      onSaved();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  function input(key: keyof typeof form, label: string, suffix: string) {
    return (
      <s-number-field
        label={label}
        suffix={suffix}
        min={1}
        value={form[key]}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setForm((current) => ({ ...current, [key]: value }));
        }}
      />
    );
  }

  return (
    <Section id="parcel" heading="Default parcel">
      <s-stack gap="base">
        <s-paragraph color="subdued">
          Used when a Shopify product has no weight or package size. You can still change it for each order.
        </s-paragraph>
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(120px, 1fr))" gap="base">
          {input("weightGrams", "Weight", "g")}
          {input("lengthCm", "Length", "cm")}
          {input("widthCm", "Width", "cm")}
          {input("heightCm", "Height", "cm")}
        </s-grid>
        <s-stack direction="inline" justifyContent="end">
          <s-button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save defaults
          </s-button>
        </s-stack>
      </s-stack>
    </Section>
  );
}

function AutomationSwitches({ value }: { value?: AutomationSettings }) {
  const api = useShopifyApi();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (patch: Partial<AutomationSettings>) => api<AutomationSettings>("automation", { method: "PATCH", body: patch }),
    onSuccess: (next) => {
      queryClient.setQueryData(["automation"], next);
      showToast("Automation updated");
    },
    onError: (caught) => showToast(errorMessage(caught), { isError: true }),
  });

  if (!value) return <s-spinner accessibilityLabel="Loading automation" />;

  return (
    <s-stack gap="base">
      {AUTOMATION_SWITCHES.map((item) => (
        <s-switch
          key={item.key}
          label={item.label}
          details={item.details}
          checked={Boolean(value[item.key])}
          disabled={toggle.isPending}
          onChange={(event) => toggle.mutate({ [item.key]: event.currentTarget.checked })}
        />
      ))}
    </s-stack>
  );
}
