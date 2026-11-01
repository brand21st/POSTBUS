"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, RefreshCw } from "lucide-react";
import { useAccountantStatus, useReadOnly } from "@/components/ai-accountant/shell";
import { GST_RATES, HelpHint, NativeSelect } from "@/components/ai-accountant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Workspace = {
  settings: {
    gst_registered: boolean | null;
    tax_inclusive: boolean;
    fiscal_year_start_month: number;
    default_rate_bps: number | null;
    default_hsn: string | null;
    books_start_date: string | null;
    costs_acknowledged: boolean;
  } | null;
  registration: { gstin: string; legal_name: string | null } | null;
};

const SECTIONS = [
  { id: "gst", label: "Business & GST" },
  { id: "tax", label: "Tax defaults" },
  { id: "books", label: "Financial year & books" },
  { id: "products", label: "Product costs" },
  { id: "automation", label: "Automation" },
  { id: "assistant", label: "AI assistant" },
  { id: "access", label: "Plan & access" },
] as const;

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleString("en-IN", { month: "long", timeZone: "UTC" }));

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-32">
      <CardContent className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
        </div>
        <div className="space-y-3">{children}</div>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, hint, children, help }: { id: string; label: string; hint?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        {help}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-3 rounded-xl border border-border p-3", disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-soft/50")}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

function LinkRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm text-ink hover:bg-surface-soft">
      <span>{children}</span>
      <ArrowRight className="size-4 text-muted" />
    </Link>
  );
}

export default function AccountingSettingsPage() {
  const workspace = useQuery({ queryKey: ["ai-accountant", "settings"], queryFn: () => api<Workspace>("/api/v1/ai-accountant/settings") });
  if (!workspace.data) return <Card className="p-6 text-sm text-muted">{workspace.error?.message ?? "Loading settings…"}</Card>;
  // Keyed so the form re-initialises from fresh server data instead of syncing state in an effect.
  return <SettingsForm key={JSON.stringify(workspace.data)} workspace={workspace.data} />;
}

function initialForm(workspace: Workspace) {
  const s = workspace.settings;
  const r = workspace.registration;
  return {
    gstRegistered: Boolean(s?.gst_registered),
    gstin: r?.gstin ?? "",
    legalName: r?.legal_name ?? "",
    taxInclusive: s?.tax_inclusive ?? true,
    fiscalYearStartMonth: s?.fiscal_year_start_month ?? 4,
    defaultRateBps: s?.default_rate_bps != null ? String(s.default_rate_bps) : "",
    defaultHsn: s?.default_hsn ?? "",
    booksStartDate: s?.books_start_date ?? "",
    costsAcknowledged: Boolean(s?.costs_acknowledged),
  };
}

function SettingsForm({ workspace }: { workspace: Workspace }) {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const status = useAccountantStatus().data;
  const initial = initialForm(workspace);
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const gstinValid = !form.gstRegistered || /^[0-9]{2}[A-Z0-9]{13}$/.test(form.gstin);
  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      api("/api/v1/ai-accountant/settings", {
        method: "PATCH",
        body: JSON.stringify({
          gstRegistered: form.gstRegistered,
          gstin: form.gstRegistered ? form.gstin : undefined,
          legalName: form.legalName || undefined,
          taxInclusive: form.taxInclusive,
          fiscalYearStartMonth: form.fiscalYearStartMonth,
          defaultRateBps: form.defaultRateBps === "" ? null : Number(form.defaultRateBps),
          defaultHsn: form.defaultHsn || null,
          booksStartDate: form.booksStartDate || null,
          costsAcknowledged: form.costsAcknowledged,
        }),
      }),
    onSuccess: () => {
      toast.success("Settings saved.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const sync = useMutation({
    mutationFn: () => api<{ posted: number }>("/api/v1/ai-accountant/ledger/sync", { method: "POST", body: "{}" }),
    onSuccess: (data) => (toast.success(`Ledger updated: ${data.posted} new entries.`), client.invalidateQueries({ queryKey: ["ai-accountant"] })),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:sticky lg:top-32 lg:h-fit lg:flex-col">
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-soft hover:text-ink">
            {section.label}
          </a>
        ))}
      </nav>

      <fieldset disabled={readOnly} className="min-w-0 space-y-4 pb-20">
        <Section id="gst" title="Business & GST" description="Decides whether your sales carry GST and whether you can claim input tax credit on purchases.">
          <Toggle
            checked={form.gstRegistered}
            onChange={(v) => set({ gstRegistered: v })}
            label="My business is registered for GST"
            description="Unregistered businesses post sales without GST and cannot claim input credit."
          />
          {form.gstRegistered ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="gstin" label="GSTIN" hint={!gstinValid ? "Enter the 15-character GSTIN." : "Your state is read from the first two digits."}>
                <Input id="gstin" value={form.gstin} maxLength={15} aria-invalid={!gstinValid} onChange={(e) => set({ gstin: e.target.value.toUpperCase().trim() })} />
              </Field>
              <Field id="legal" label="Legal name">
                <Input id="legal" value={form.legalName} maxLength={160} onChange={(e) => set({ legalName: e.target.value })} />
              </Field>
            </div>
          ) : null}
        </Section>

        <Section id="tax" title="Tax defaults" description="Used whenever an order or product has no GST of its own.">
          <Toggle checked={form.taxInclusive} onChange={(v) => set({ taxInclusive: v })} label="My prices include GST" description="Most D2C stores show GST-inclusive prices." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="rate" label="Default GST rate" help={<HelpHint label="default GST rate">Applied to products that don&apos;t have their own rate. Leave empty to require a rate per product.</HelpHint>}>
              <NativeSelect id="rate" className="w-full" value={form.defaultRateBps} onChange={(e) => set({ defaultRateBps: e.target.value })}>
                <option value="">None — set per product</option>
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r / 100}%
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="hsn" label="Default HSN">
              <Input id="hsn" value={form.defaultHsn} maxLength={8} inputMode="numeric" onChange={(e) => set({ defaultHsn: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          <LinkRow href="/dashboard/ai-accountant/gst#products">
            Per-product HSN and rates
            {status?.counts.productsMissingRate ? <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{status.counts.productsMissingRate} missing</span> : null}
          </LinkRow>
        </Section>

        <Section id="books" title="Financial year & books" description="Controls report periods and which orders are posted to your ledger.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="fy" label="Financial year starts in" hint="April for most Indian businesses.">
              <NativeSelect id="fy" className="w-full" value={form.fiscalYearStartMonth} onChange={(e) => set({ fiscalYearStartMonth: Number(e.target.value) })}>
                {MONTHS.map((month, i) => (
                  <option key={month} value={i + 1}>
                    {month}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="start" label="Books start date" hint="Orders before this date are not posted.">
              <Input id="start" type="date" value={form.booksStartDate} onChange={(e) => set({ booksStartDate: e.target.value })} />
            </Field>
          </div>
          <LinkRow href="/dashboard/ai-accountant/ledger">Enter opening balances (manual journal entry)</LinkRow>
        </Section>

        <Section id="products" title="Product costs" description="Unit costs give you cost of goods sold and verified profit.">
          <p className="text-sm text-ink">
            {status ? `${status.counts.activeProducts - status.counts.productsMissingCost} of ${status.counts.activeProducts} active products have a cost.` : "—"}
          </p>
          <LinkRow href="/dashboard/ai-accountant/gst#products">Add unit costs</LinkRow>
          <Toggle
            checked={form.costsAcknowledged}
            onChange={(v) => set({ costsAcknowledged: v })}
            label="I understand profit stays unverified without costs"
            description="Hides the setup reminder; profit is still marked not verified."
          />
        </Section>

        <Section id="automation" title="Automation" description="What PostBus does for you in the background.">
          <ul className="space-y-1.5 text-sm text-ink">
            <li>• Booked shipments, RTOs, India Post postage and PostBus fees are posted daily (last 35 days re-checked).</li>
            <li>• COD remittances that match exactly are posted when you upload a report.</li>
            <li>• Expenses and purchases post the moment you save them.</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={readOnly || sync.isPending} onClick={() => sync.mutate()}>
              <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} /> Sync now
            </Button>
            <span className="text-xs text-muted">{status?.lastSyncedAt ? `Last synced ${formatDate(status.lastSyncedAt, true)}` : "Never synced"}</span>
          </div>
        </Section>

        <Section id="assistant" title="AI assistant" description="Questions included with your add-on; a question isn't counted if the AI fails to answer.">
          {status ? (
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-surface-soft">
                <div className="h-full bg-brand" style={{ width: `${Math.min(100, (status.quota.used / Math.max(1, status.quota.included)) * 100)}%` }} />
              </div>
              <p className="text-sm text-ink">
                {status.quota.used} of {status.quota.included} used · resets {status.addon.currentPeriodEnd ? formatDate(status.addon.currentPeriodEnd) : "each billing period"}
              </p>
            </div>
          ) : null}
          <LinkRow href="/dashboard/ai-accountant/assistant">Open Ask AI</LinkRow>
        </Section>

        <Section id="access" title="Plan & access" description="Your add-on and who can change the books.">
          <p className="text-sm text-ink">
            Status: <span className="font-medium">{status?.addon.status ?? "—"}</span>
            {status?.addon.currentPeriodEnd ? ` · renews ${formatDate(status.addon.currentPeriodEnd)}` : ""}
          </p>
          <LinkRow href="/dashboard/integrations">Manage or renew the add-on</LinkRow>
          <div className="overflow-hidden rounded-xl border border-border text-sm">
            {[
              ["Owner, Admin", "Change settings, record expenses, post and reverse entries, import COD"],
              ["Manager, Operator, Viewer", "View everything, export, ask the AI"],
            ].map(([role, can]) => (
              <div key={role} className="grid grid-cols-[150px_1fr] gap-3 border-t border-border px-3 py-2 first:border-t-0">
                <span className="font-medium text-ink">{role}</span>
                <span className="text-muted">{can}</span>
              </div>
            ))}
          </div>
        </Section>
      </fieldset>

      {dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:left-auto lg:right-6 lg:bottom-6 lg:rounded-2xl lg:border lg:shadow-lg">
          <div className="flex items-center justify-end gap-3">
            <span className="mr-auto text-sm text-muted lg:mr-2">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => setForm(initial)}>
              Discard
            </Button>
            <Button size="sm" disabled={readOnly || save.isPending || !gstinValid} onClick={() => save.mutate()}>
              Save settings
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
