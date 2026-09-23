"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { InvoicePreview } from "@/components/invoices/invoice-preview";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/lib/hooks/use-api";
import {
  DEFAULT_INVOICE_APPEARANCE,
  INVOICE_PRESETS,
  invoiceContrastWarnings,
  parseInvoiceAppearance,
  type InvoiceAppearance,
} from "@/modules/invoices/schema";
import type { InvoicePreviewData } from "@/types/api";

const COLOR_FIELDS: Array<{ key: keyof InvoiceAppearance; label: string }> = [
  { key: "primaryColor", label: "Primary" },
  { key: "secondaryColor", label: "Secondary" },
  { key: "accentColor", label: "Accent" },
  { key: "textColor", label: "Text" },
  { key: "tableHeaderColor", label: "Table header" },
  { key: "borderColor", label: "Border" },
  { key: "totalHighlightColor", label: "Total" },
];

type SettingsResponse = {
  appearance: InvoiceAppearance;
  gstin?: string | null;
  businessEmail?: string | null;
  website?: string | null;
  resolvedWebsite?: string | null;
};

type PreviewResponse = {
  sample: boolean;
  data: InvoicePreviewData;
  appearance: InvoiceAppearance;
};

function presetName(appearance: InvoiceAppearance) {
  return (
    Object.entries(INVOICE_PRESETS).find(
      ([, preset]) => JSON.stringify(preset) === JSON.stringify(appearance)
    )?.[0] ?? "Custom"
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="grid grid-cols-[7rem_1.75rem_minmax(4.75rem,1fr)] items-center gap-2">
      <Label htmlFor={id} className="truncate text-xs font-medium text-muted">
        {label}
      </Label>
      <input
        id={id}
        type="color"
        aria-label={label}
        className="size-8 cursor-pointer rounded-md border border-border bg-card p-0.5"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <Input
        value={draft}
        aria-label={`${label} hex`}
        className="h-8 px-2 font-mono text-xs uppercase"
        onChange={(event) => {
          const raw = event.target.value.trim().toUpperCase();
          const next = raw.startsWith("#") ? raw : `#${raw}`;
          setDraft(next.slice(0, 7));
          if (/^#[0-9A-F]{6}$/.test(next)) onChange(next);
        }}
      />
    </div>
  );
}

export function InvoiceEditor() {
  const queryClient = useQueryClient();
  const [appearance, setAppearance] = useState<InvoiceAppearance>(DEFAULT_INVOICE_APPEARANCE);
  const [gstin, setGstin] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const settings = useQuery({
    queryKey: ["invoice-template"],
    queryFn: () => api<SettingsResponse>("/api/v1/invoice-template"),
  });
  const preview = useQuery({
    queryKey: ["invoice-template-preview"],
    queryFn: () => api<PreviewResponse>("/api/v1/invoice-template/preview-data"),
  });

  useEffect(() => {
    if (!settings.data) return;
    setAppearance(parseInvoiceAppearance(settings.data.appearance));
    setGstin(settings.data.gstin ?? "");
    setBusinessEmail(settings.data.businessEmail ?? "");
    setWebsite(settings.data.website ?? "");
  }, [settings.data]);

  const warnings = invoiceContrastWarnings(appearance);
  const selectedPreset = presetName(appearance);

  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/invoice-template", {
        method: "PUT",
        body: JSON.stringify({ appearance, gstin, businessEmail, website }),
      }),
    onSuccess: () => {
      toast.success("Invoice design saved. New invoices will use these colors.");
      queryClient.invalidateQueries({ queryKey: ["invoice-template"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-template-preview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = useMutation({
    mutationFn: () =>
      api("/api/v1/invoice-template", {
        method: "PUT",
        body: JSON.stringify({ reset: true }),
      }),
    onSuccess: (data) => {
      const saved = data as SettingsResponse;
      setAppearance(parseInvoiceAppearance(saved.appearance));
      setWebsite(saved.website ?? website);
      setResetOpen(false);
      toast.success("Invoice design reset to the default theme.");
      queryClient.invalidateQueries({ queryKey: ["invoice-template"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewData: InvoicePreviewData = preview.data?.data ?? {
    storeName: "Sample Store",
    storePhone: "9876543210",
    storeEmail: businessEmail,
    storeGstin: gstin,
    storeWebsite: website || "www.aurimo.in",
    storeAddress: ["Sample address"],
    hasLogo: false,
    invoiceNumber: "INV-2026-000001",
    invoiceDate: "23 Sep 2026",
    orderNumber: "#12345",
    orderDate: "23 Sep 2026",
    shipmentId: "sample",
    trackingNumber: "CL556974806IN",
    paymentMethod: "COD",
    paymentStatus: "COD",
    currency: "INR",
    customer: { name: "Customer", phone: "", email: "", lines: [] },
    billing: { name: "Customer", phone: "", email: "", lines: ["Billing address"] },
    shipping: { name: "Customer", phone: "", email: "", lines: ["Shipping address"] },
    items: [{ title: "Cotton Shirt", sku: "SHIRT-BLK", quantity: 2, unitPrice: 799, lineTotal: 1598 }],
    subtotal: 1598,
    discount: 0,
    shippingAmount: 0,
    taxAmount: 0,
    total: 1598,
    codAmount: 1598,
  };

  const livePreview = {
    ...previewData,
    storeGstin: gstin || previewData.storeGstin,
    storeEmail: businessEmail || previewData.storeEmail,
    storeWebsite: website || previewData.storeWebsite,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customize Invoice"
        description="New invoices use this design. Existing PDFs stay unchanged until you regenerate them."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setResetOpen(true)}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="size-4" />
              Save
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[19.5rem_minmax(0,1fr)]">
        <aside className="order-2 space-y-4 lg:order-1 lg:sticky lg:top-4">
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Theme</p>
              <p className="mt-0.5 text-xs text-muted">Pick a preset, then fine-tune any color.</p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(INVOICE_PRESETS).map(([name, preset]) => {
                const active = selectedPreset === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setAppearance(preset)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors",
                      active ? "bg-brand/10 text-brand" : "text-muted hover:bg-surface-soft hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "size-7 rounded-full border shadow-sm",
                        active ? "border-brand ring-2 ring-brand/25" : "border-border"
                      )}
                      style={{ background: preset.primaryColor }}
                    />
                    {name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Colors</p>
            <div className="max-w-[20rem] space-y-2">
              {COLOR_FIELDS.map((field) => (
                <ColorField
                  key={field.key}
                  id={field.key}
                  label={field.label}
                  value={appearance[field.key]}
                  onChange={(hex) => setAppearance({ ...appearance, [field.key]: hex })}
                />
              ))}
            </div>
            {warnings.length > 0 ? (
              <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                {warnings.map((warning) => (
                  <p key={warning.field} className="text-[11px] leading-snug text-amber-800">
                    {warning.message} Try {warning.suggestion}.
                  </p>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Business</p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="gstin" className="text-xs text-muted">
                  GSTIN
                </Label>
                <Input
                  id="gstin"
                  value={gstin}
                  maxLength={15}
                  placeholder="If registered"
                  className="h-9 font-mono text-xs uppercase"
                  onChange={(event) => setGstin(event.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-email" className="text-xs text-muted">
                  Email
                </Label>
                <Input
                  id="invoice-email"
                  type="email"
                  value={businessEmail}
                  placeholder="Shown on the invoice"
                  className="h-9 text-sm"
                  onChange={(event) => setBusinessEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-website" className="text-xs text-muted">
                  Website
                </Label>
                <Input
                  id="invoice-website"
                  value={website}
                  placeholder={settings.data?.resolvedWebsite || "www.yourstore.in"}
                  className="h-9 text-sm"
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>
            </div>
          </section>
        </aside>

        <section className="order-1 min-w-0 rounded-2xl border border-border bg-surface-soft lg:order-2 lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Live preview</p>
              <p className="text-xs text-muted">
                {preview.data?.sample ? "Sample data until a booked shipment exists." : "Using your latest booked shipment."}
              </p>
            </div>
            <span className="rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-muted">
              {selectedPreset}
            </span>
          </div>
          <div className="max-h-[calc(100vh-12rem)] overflow-auto p-4">
            <InvoicePreview appearance={appearance} data={livePreview} />
          </div>
        </section>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset invoice design?</DialogTitle>
            <DialogDescription>Reset invoice design to the default theme?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => reset.mutate()} disabled={reset.isPending}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
