"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useReadOnly } from "@/components/ai-accountant/shell";
import { GST_RATES, NativeSelect } from "@/components/ai-accountant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";

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

export default function AccountingSettingsPage() {
  const workspace = useQuery({ queryKey: ["ai-accountant", "settings"], queryFn: () => api<Workspace>("/api/v1/ai-accountant/settings") });
  if (!workspace.data) return <Card className="max-w-3xl p-6 text-sm text-muted">{workspace.error?.message ?? "Loading settings…"}</Card>;
  // Keyed so the form re-initialises from fresh server data instead of syncing state in an effect.
  return <SettingsForm key={JSON.stringify(workspace.data)} workspace={workspace.data} />;
}

function SettingsForm({ workspace }: { workspace: Workspace }) {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const s = workspace.settings;
  const r = workspace.registration;
  const [form, setForm] = useState({
    gstRegistered: Boolean(s?.gst_registered),
    gstin: r?.gstin ?? "",
    legalName: r?.legal_name ?? "",
    taxInclusive: s?.tax_inclusive ?? true,
    fiscalYearStartMonth: s?.fiscal_year_start_month ?? 4,
    defaultRateBps: s?.default_rate_bps != null ? String(s.default_rate_bps) : "",
    defaultHsn: s?.default_hsn ?? "",
    booksStartDate: s?.books_start_date ?? "",
    costsAcknowledged: Boolean(s?.costs_acknowledged),
  });
  const gstinValid = !form.gstRegistered || /^[0-9]{2}[A-Z0-9]{13}$/.test(form.gstin);
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
      toast.success("Accounting settings saved.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Accounting setup</CardTitle>
        <CardDescription>These settings control GST splits, default tax rates and where your books begin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-3" disabled={readOnly}>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={form.gstRegistered} onChange={(e) => setForm({ ...form, gstRegistered: e.target.checked })} />
            My business is registered for GST
          </label>
          {form.gstRegistered ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="gstin">GSTIN</Label>
                <Input id="gstin" value={form.gstin} maxLength={15} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase().trim() })} />
                {!gstinValid ? <p className="text-xs text-rose-600">Enter a 15-character GSTIN.</p> : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="legal">Legal name</Label>
                <Input id="legal" value={form.legalName} maxLength={160} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">Unregistered businesses post sales without GST and cannot claim input tax credit.</p>
          )}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={readOnly}>
          <div className="space-y-1">
            <Label htmlFor="rate">Default GST rate for products</Label>
            <NativeSelect id="rate" className="w-full" value={form.defaultRateBps} onChange={(e) => setForm({ ...form, defaultRateBps: e.target.value })}>
              <option value="">None — require a rate per product</option>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r / 100}%
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hsn">Default HSN</Label>
            <Input id="hsn" value={form.defaultHsn} maxLength={8} inputMode="numeric" onChange={(e) => setForm({ ...form, defaultHsn: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fy">Financial year starts in</Label>
            <NativeSelect id="fy" className="w-full" value={form.fiscalYearStartMonth} onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(Date.UTC(2000, i, 1)).toLocaleString("en-IN", { month: "long", timeZone: "UTC" })}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="start">Books start date</Label>
            <Input id="start" type="date" value={form.booksStartDate} onChange={(e) => setForm({ ...form, booksStartDate: e.target.value })} />
            <p className="text-xs text-muted">Orders before this date are not posted. Enter opening balances as a manual journal entry.</p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.taxInclusive} onChange={(e) => setForm({ ...form, taxInclusive: e.target.checked })} />
            My product prices include GST
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.costsAcknowledged} onChange={(e) => setForm({ ...form, costsAcknowledged: e.target.checked })} />
            I understand profit stays unverified until product costs or purchases are entered
          </label>
        </fieldset>
        <Button disabled={readOnly || save.isPending || !gstinValid} onClick={() => save.mutate()}>
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}
