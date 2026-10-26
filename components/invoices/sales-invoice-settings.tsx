"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { financialYearLabel, formatSalesInvoiceNumber } from "@/modules/sales-invoices/tax";
import type { SellerProfile } from "@/modules/sales-invoices/profile";
import type { SalesInvoiceSettings } from "@/modules/sales-invoices/service";

type Response = { settings: SalesInvoiceSettings; profile: SellerProfile };

export function SalesInvoiceSettingsForm() {
  const query = useQuery({
    queryKey: ["sales-invoice-settings"],
    queryFn: () => api<Response>("/api/v1/sales-invoice-settings"),
  });
  if (!query.data) return null;
  return <SettingsFields key={query.dataUpdatedAt} initial={query.data} />;
}

function SettingsFields({ initial }: { initial: Response }) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(initial.settings);
  const [profile, setProfile] = useState(initial.profile);
  const save = useMutation({
    mutationFn: () => api("/api/v1/sales-invoice-settings", { method: "PUT", body: JSON.stringify({ settings, profile }) }),
    onSuccess: () => {
      toast.success("Invoice settings saved.");
      queryClient.invalidateQueries({ queryKey: ["sales-invoice-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!settings || !profile) return null;
  let preview = "";
  try {
    preview = formatSalesInvoiceNumber(settings.prefix || "INV", financialYearLabel(new Date(), settings.financialYearStartMonth), 1);
  } catch {
    preview = "Prefix must be 1 to 4 letters or digits.";
  }
  return (
    <section className="space-y-4 rounded-xl border border-border p-4">
      <div>
        <h2 className="text-lg font-semibold">Sales invoice</h2>
        <p className="text-sm text-muted">Seller GST details are stored once. The shipment PDF header uses the same GSTIN.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Registration
          <select className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2" value={profile.scheme} onChange={(event) => setProfile({ ...profile, scheme: event.target.value as SellerProfile["scheme"] })}>
            <option value="UNREGISTERED">Unregistered</option>
            <option value="REGULAR">Regular</option>
            <option value="COMPOSITION">Composition</option>
          </select>
        </label>
        <Field label="GSTIN" value={profile.gstin} onChange={(gstin) => setProfile({ ...profile, gstin })} />
        <Field label="Legal name" value={profile.legalName} onChange={(legalName) => setProfile({ ...profile, legalName })} />
        <Field label="Trade name" value={profile.tradeName} onChange={(tradeName) => setProfile({ ...profile, tradeName })} />
        <Field label="PAN" value={profile.pan} onChange={(pan) => setProfile({ ...profile, pan })} />
        <Field label="Address" value={profile.line1} onChange={(line1) => setProfile({ ...profile, line1 })} />
        <Field label="City" value={profile.city} onChange={(city) => setProfile({ ...profile, city })} />
        <Field label="State" value={profile.state} onChange={(state) => setProfile({ ...profile, state })} />
        <Field label="PIN" value={profile.pincode} onChange={(pincode) => setProfile({ ...profile, pincode })} />
        <Field label="Phone" value={profile.phone} onChange={(phone) => setProfile({ ...profile, phone })} />
        <Field label="Email" value={profile.email} onChange={(email) => setProfile({ ...profile, email })} />
        <label className="text-sm">Template
          <select className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2" value={settings.template} onChange={(event) => setSettings({ ...settings, template: event.target.value as SalesInvoiceSettings["template"] })}>
            <option value="CLASSIC">Classic</option>
            <option value="GST">Professional GST</option>
          </select>
        </label>
        <Field label="Prefix" value={settings.prefix} onChange={(prefix) => setSettings({ ...settings, prefix })} />
      </div>
      <p className="text-sm">Next number preview: {preview}</p>
      <div className="grid gap-2 md:grid-cols-2">
        <Toggle label="Show SKU" checked={settings.showSku} onChange={(showSku) => setSettings({ ...settings, showSku })} />
        <Toggle label="Show variant" checked={settings.showVariant} onChange={(showVariant) => setSettings({ ...settings, showVariant })} />
        <Toggle label="Show HSN on classic template" checked={settings.showHsn} onChange={(showHsn) => setSettings({ ...settings, showHsn })} />
        <Toggle label="Show payment method" checked={settings.showPaymentMethod} onChange={(showPaymentMethod) => setSettings({ ...settings, showPaymentMethod })} />
        <Toggle label="Show order number" checked={settings.showOrderNumber} onChange={(showOrderNumber) => setSettings({ ...settings, showOrderNumber })} />
        <Toggle label="Show shipping address" checked={settings.showShippingAddress} onChange={(showShippingAddress) => setSettings({ ...settings, showShippingAddress })} />
        <Toggle label="Automatic issue" checked={settings.autoIssue} onChange={(autoIssue) => setSettings({ ...settings, autoIssue })} />
        <label className="text-sm">Automatic event
          <select className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2" value={settings.autoIssueEvent ?? ""} onChange={(event) => setSettings({ ...settings, autoIssueEvent: event.target.value === "PAYMENT_CONFIRMED" ? "PAYMENT_CONFIRMED" : event.target.value === "ORDER_CREATED" ? "ORDER_CREATED" : null })}>
            <option value="">Off</option>
            <option value="ORDER_CREATED">Order created</option>
            <option value="PAYMENT_CONFIRMED">Payment confirmed</option>
          </select>
        </label>
      </div>
      <div>
        <Label>Terms</Label>
        <Textarea value={settings.terms} onChange={(event) => setSettings({ ...settings, terms: event.target.value })} />
      </div>
      <div>
        <Label>Thank-you note</Label>
        <Textarea value={settings.thankYou} onChange={(event) => setSettings({ ...settings, thankYou: event.target.value })} />
      </div>
      <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>Save sales invoice settings</Button>
    </section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">{label}
      <Input className="mt-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
