"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useReadOnly } from "@/components/ai-accountant/shell";
import { ExportButtons, GST_RATES, Money, NativeSelect, Notes, TableShell, istToday, rupeesToPaiseInput, td, th } from "@/components/ai-accountant/shared";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Product = { id: string; name: string; sku: string; active: boolean; unitCostPaise: number | null; profile: { hsn_sac: string | null; rate_bps: number } | null };
type Totals = { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
type Draft = {
  status: string;
  reason?: string;
  type: "GSTR1" | "GSTR3B";
  period: { from: string; to: string; label: string };
  missing?: Record<string, number>;
  disclaimer?: string;
  totals?: Totals;
  invoiceCount?: number;
  b2cs?: Array<Totals & { placeOfSupply: string; rateBps: number }>;
  b2b?: Array<{ orderNumber: string; customerGstin: string; valuePaise: number }>;
  hsn?: Array<Totals & { hsn: string; rateBps: number }>;
  outwardTaxable?: Totals;
  itcAvailable?: Omit<Totals, "taxablePaise">;
  cashPayable?: Omit<Totals, "taxablePaise">;
  totalCashPaise?: number;
};

function ProfileRow({ product, readOnly }: { product: Product; readOnly: boolean }) {
  const client = useQueryClient();
  const [hsn, setHsn] = useState(product.profile?.hsn_sac ?? "");
  const [rate, setRate] = useState<number | "">(product.profile?.rate_bps ?? "");
  // A product without a profile only gets one once a rate is chosen; saving a cost alone never invents a rate.
  const dirty = rate !== "" && (hsn !== (product.profile?.hsn_sac ?? "") || rate !== (product.profile?.rate_bps ?? -1));
  const initialCost = product.unitCostPaise !== null ? (product.unitCostPaise / 100).toFixed(2) : "";
  const [cost, setCost] = useState(initialCost);
  const costDirty = cost !== initialCost && rupeesToPaiseInput(cost) !== null;
  const save = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await api("/api/v1/ai-accountant/tax-profiles", { method: "POST", body: JSON.stringify({ productId: product.id, hsnSac: hsn || null, rateBps: rate }) });
      }
      if (costDirty) {
        await api("/api/v1/ai-accountant/product-costs", { method: "POST", body: JSON.stringify({ productId: product.id, unitCostPaise: rupeesToPaiseInput(cost) }) });
      }
    },
    onSuccess: () => (toast.success(`Saved ${product.sku}.`), client.invalidateQueries({ queryKey: ["ai-accountant", "tax-profiles"] })),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <tr>
      <td className={td}>
        {product.name}
        <span className="block text-xs text-muted">{product.sku}</span>
      </td>
      <td className={td}>
        <Input aria-label={`HSN for ${product.sku}`} className="h-9 w-28" value={hsn} maxLength={8} inputMode="numeric" disabled={readOnly} onChange={(e) => setHsn(e.target.value.replace(/\D/g, ""))} />
      </td>
      <td className={td}>
        <NativeSelect aria-label={`GST rate for ${product.sku}`} className="h-9" value={rate} disabled={readOnly} onChange={(e) => setRate(e.target.value === "" ? "" : Number(e.target.value))}>
          <option value="">Not set</option>
          {GST_RATES.map((r) => (
            <option key={r} value={r}>
              {r / 100}%
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className={td}>
        <Input aria-label={`Unit cost for ${product.sku}`} className="h-9 w-28" value={cost} inputMode="decimal" placeholder="₹ cost" disabled={readOnly} onChange={(e) => setCost(e.target.value)} />
      </td>
      <td className={cn(td, "text-right")}>
        {!dirty && !costDirty ? (
          product.profile ? <StatusBadge value="READY" /> : <span className="text-xs text-muted">Needs rate</span>
        ) : (
          <Button size="xs" disabled={readOnly || save.isPending || (hsn !== "" && !/^\d{4,8}$/.test(hsn))} onClick={() => save.mutate()}>
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}

function TaxRow({ label, t }: { label: string; t?: Partial<Totals> }) {
  return (
    <tr>
      <td className={td}>{label}</td>
      <td className={cn(td, "text-right")}>{t?.taxablePaise !== undefined ? <Money paise={t.taxablePaise} /> : "—"}</td>
      <td className={cn(td, "text-right")}>
        <Money paise={t?.igstPaise ?? 0} />
      </td>
      <td className={cn(td, "text-right")}>
        <Money paise={t?.cgstPaise ?? 0} />
      </td>
      <td className={cn(td, "text-right")}>
        <Money paise={t?.sgstPaise ?? 0} />
      </td>
    </tr>
  );
}

const MISSING_LABELS: Record<string, string> = {
  tax_rate: "orders have products without a GST rate (set it below or a default rate in settings)",
  place_of_supply: "orders have no recognisable delivery state",
};

export default function GstPage() {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const [y, m] = istToday().split("-").map(Number) as [number, number];
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const [month, setMonth] = useState(prev.month);
  const [year, setYear] = useState(prev.year);
  const [type, setType] = useState<"GSTR1" | "GSTR3B">("GSTR3B");
  const [csv, setCsv] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const profiles = useQuery({ queryKey: ["ai-accountant", "tax-profiles"], queryFn: () => api<{ products: Product[]; missing: number }>("/api/v1/ai-accountant/tax-profiles") });
  const generate = useMutation({
    mutationFn: () => api<Draft>("/api/v1/ai-accountant/gst/drafts", { method: "POST", body: JSON.stringify({ type, month, year }) }),
    onSuccess: (data) => setDraft(data),
    onError: (error: Error) => toast.error(error.message),
  });
  const importCsv = useMutation({
    mutationFn: () => api<{ saved: number; errors: string[] }>("/api/v1/ai-accountant/tax-profiles/import", { method: "POST", body: JSON.stringify({ csv }) }),
    onSuccess: (data) => {
      toast.success(`Saved ${data.saved} products.`);
      if (data.errors.length) toast.error(data.errors.slice(0, 3).join(" "));
      client.invalidateQueries({ queryKey: ["ai-accountant", "tax-profiles"] });
      setCsv("");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const period = { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${last}` };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>GST return drafts</CardTitle>
          <CardDescription>Prepared from booked shipments, RTOs, purchases and expenses. PostBus never files on the GST portal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Return" value={type} onChange={(e) => setType(e.target.value as "GSTR1" | "GSTR3B")}>
              <option value="GSTR3B">GSTR-3B summary</option>
              <option value="GSTR1">GSTR-1 outward supplies</option>
            </NativeSelect>
            <NativeSelect aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(Date.UTC(2000, i, 1)).toLocaleString("en-IN", { month: "long", timeZone: "UTC" })}
                </option>
              ))}
            </NativeSelect>
            <Input aria-label="Year" type="number" className="h-10 w-24" value={year} min={2017} max={2100} onChange={(e) => setYear(Number(e.target.value))} />
            <Button size="sm" disabled={readOnly || generate.isPending} onClick={() => generate.mutate()}>
              Prepare draft
            </Button>
            <ExportButtons kind={type} period={period} />
          </div>
          {draft?.status === "INCOMPLETE" ? (
            <Notes notes={["Add your GSTIN in AI Accountant settings to prepare GST drafts."]} />
          ) : draft ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <StatusBadge value={draft.status} />
                <span className="text-muted">
                  {draft.period.label}
                  {draft.invoiceCount !== undefined ? ` · ${draft.invoiceCount} invoices` : ""}
                </span>
              </div>
              <Notes notes={Object.entries(draft.missing ?? {}).map(([key, count]) => `${count} ${MISSING_LABELS[key] ?? key}.`)} />
              <TableShell>
                <thead>
                  <tr>
                    <th className={th}>{draft.type === "GSTR3B" ? "Section" : "Group"}</th>
                    <th className={cn(th, "text-right")}>Taxable</th>
                    <th className={cn(th, "text-right")}>IGST</th>
                    <th className={cn(th, "text-right")}>CGST</th>
                    <th className={cn(th, "text-right")}>SGST</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.type === "GSTR3B" ? (
                    <>
                      <TaxRow label="3.1(a) Outward taxable supplies" t={draft.outwardTaxable} />
                      <TaxRow label="4(A)(5) Input tax credit" t={draft.itcAvailable} />
                      <TaxRow label="Payable in cash after set-off" t={draft.cashPayable} />
                    </>
                  ) : (
                    <>
                      {(draft.b2cs ?? []).map((row) => (
                        <TaxRow key={`${row.placeOfSupply}-${row.rateBps}`} label={`B2CS · state ${row.placeOfSupply} · ${row.rateBps / 100}%`} t={row} />
                      ))}
                      {(draft.hsn ?? []).map((row) => (
                        <TaxRow key={`h-${row.hsn}-${row.rateBps}`} label={`HSN ${row.hsn} · ${row.rateBps / 100}%`} t={row} />
                      ))}
                      <TaxRow label="Net outward (after credit notes)" t={draft.totals} />
                    </>
                  )}
                </tbody>
              </TableShell>
              {draft.type === "GSTR1" && draft.b2b?.length ? <p className="text-xs text-muted">{draft.b2b.length} B2B invoices to registered buyers are in the export.</p> : null}
              {draft.type === "GSTR3B" ? (
                <p className="text-sm font-medium text-ink">
                  Estimated cash payable: <Money paise={draft.totalCashPaise ?? 0} />
                </p>
              ) : null}
              <p className="text-xs text-muted">{draft.disclaimer}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products: HSN, GST rate and unit cost</CardTitle>
          <CardDescription>
            {profiles.data?.missing ? `${profiles.data.missing} active products have no rate yet. ` : ""}
            Products without a rate use the default from <Link href="/dashboard/ai-accountant/settings" className="underline">settings</Link>. Unit cost is used for cost of goods sold.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TableShell>
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>HSN</th>
                <th className={th}>GST rate</th>
                <th className={th}>Unit cost</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {(profiles.data?.products ?? []).map((product) => (
                <ProfileRow key={`${product.id}-${product.profile?.rate_bps ?? "x"}-${product.profile?.hsn_sac ?? ""}-${product.unitCostPaise ?? ""}`} product={product} readOnly={readOnly} />
              ))}
              {profiles.data && !profiles.data.products.length ? (
                <tr>
                  <td colSpan={5} className={cn(td, "py-8 text-center text-muted")}>
                    No products yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableShell>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Bulk update</p>
            <Textarea rows={4} value={csv} disabled={readOnly} onChange={(e) => setCsv(e.target.value)} placeholder={"sku,hsn,rate\nTEE-BLK-M,6109,5\nMUG-01,6912,18"} />
            <Button size="sm" variant="secondary" disabled={readOnly || !csv.trim() || importCsv.isPending} onClick={() => importCsv.mutate()}>
              Import rates
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
