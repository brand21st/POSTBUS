"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { downloadInvoicePdf, printInvoicePdf } from "@/lib/invoices/preview";
import { api } from "@/lib/hooks/use-api";
import { billingAfterSameAddressToggle, type PartySnapshot } from "@/modules/sales-invoices/tax";

type Line = {
  name: string;
  variant?: string | null;
  sku?: string | null;
  hsn?: string | null;
  quantity: number;
  unit?: string | null;
  unitPricePaise: number;
  discountPaise: number;
  rateBps: number | null;
  treatment: "TAXABLE" | "EXEMPT" | "ZERO_RATED";
  lineTotalPaise: number;
};

type Invoice = {
  id: string;
  invoiceNumber: string | null;
  orderNumber: string;
  status: "DRAFT" | "REVIEW" | "ISSUED" | "CANCELLED";
  documentType: string;
  taxSource: string;
  pricing: "INCLUSIVE" | "EXCLUSIVE";
  paymentStatus: string;
  paymentMethod: string;
  billing: PartySnapshot;
  shipping: PartySnapshot;
  posStateName: string | null;
  posStateCode: string | null;
  reviewReasons: string[];
  lines: Line[];
  shippingPaise: number;
  shippingTaxable: boolean;
  shippingRateBps: number | null;
  grandTotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  codCollectPaise: number;
  amountPaidPaise: number;
  currency: string;
};

function rupees(paise: number) {
  return formatCurrency(paise / 100);
}

export default function SalesInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoice = useQuery({
    queryKey: ["sales-invoice", params.id],
    queryFn: () => api<Invoice>(`/api/v1/sales-invoices/${params.id}`),
  });
  if (!invoice.data) return <p className="text-sm text-muted">{invoice.isLoading ? "Loading invoice…" : "Invoice not found."}</p>;
  return <InvoiceForm key={`${invoice.data.id}:${invoice.data.status}:${invoice.data.grandTotalPaise}`} data={invoice.data} />;
}

function InvoiceForm({ data }: { data: Invoice }) {
  const queryClient = useQueryClient();
  const [billing, setBilling] = useState(data.billing);
  const [shipping, setShipping] = useState(data.shipping);
  const [explicitBilling, setExplicitBilling] = useState<PartySnapshot | null>(data.billing);
  const [same, setSame] = useState(false);
  const [lines, setLines] = useState(data.lines);
  const [shippingAmount, setShippingAmount] = useState((data.shippingPaise / 100).toFixed(2));
  const [shippingRate, setShippingRate] = useState(data.shippingRateBps == null ? "" : String(data.shippingRateBps / 100));
  const [shippingTaxable, setShippingTaxable] = useState(data.shippingTaxable);
  const [pricing, setPricing] = useState(data.pricing);
  const [recalculate, setRecalculate] = useState(false);

  const editable = data.status !== "ISSUED" && data.status !== "CANCELLED";
  const save = useMutation({
    mutationFn: () => api(`/api/v1/sales-invoices/${data.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        billing,
        shipping,
        sameAsShipping: same,
        explicitBilling,
        pricing,
        lines: lines.map((line) => ({ ...line, rateBps: line.rateBps })),
        shippingAmountPaise: Math.round(Number(shippingAmount || 0) * 100),
        shippingTaxable,
        shippingRateBps: shippingRate === "" ? null : Math.round(Number(shippingRate) * 100),
        confirmRecalculate: recalculate,
      }),
    }),
    onSuccess: () => {
      toast.success("Draft saved.");
      queryClient.invalidateQueries({ queryKey: ["sales-invoice", data.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const act = useMutation({
    mutationFn: (path: string) => api(`/api/v1/sales-invoices/${data.id}/${path}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-invoice", data.id] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleSame = (checked: boolean) => {
    if (checked) setExplicitBilling(billing);
    const nextBilling = billingAfterSameAddressToggle({ same: checked, shipping, billing, explicitBilling });
    setBilling(nextBilling);
    setSame(checked);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.invoiceNumber || "Draft invoice"}
        description={`${data.documentType.replaceAll("_", " ")} · ${data.orderNumber} · ${data.taxSource}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={data.status} />
            {editable ? <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>Save draft</Button> : null}
            {editable ? <Button type="button" onClick={() => act.mutate("issue")} disabled={act.isPending}>Issue</Button> : null}
            {data.status === "ISSUED" ? <Button type="button" variant="secondary" onClick={() => downloadInvoicePdf(data.id, data.invoiceNumber || "invoice", "sales")}>Download</Button> : null}
            {data.status === "ISSUED" ? <Button type="button" variant="secondary" onClick={() => printInvoicePdf(data.id, "sales")}>Print</Button> : null}
            {data.status === "ISSUED" ? <Button type="button" variant="secondary" onClick={() => act.mutate("credit-note")}>Credit note</Button> : null}
            {data.status === "ISSUED" ? <Button type="button" variant="secondary" onClick={() => act.mutate("cancel")}>Cancel</Button> : null}
          </div>
        }
      />
      {data.reviewReasons.length ? <p className="text-sm text-amber-700">Needs review: {data.reviewReasons.join(", ")}. This PDF is not an IRP e-invoice.</p> : <p className="text-sm text-muted">IRP e-invoicing is not generated here.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <PartyFields title="Bill to" party={billing} onChange={setBilling} disabled={!editable} />
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={same} disabled={!editable} onChange={(event) => toggleSame(event.target.checked)} />
            Billing address same as shipping address
          </label>
          <PartyFields title="Ship to" party={shipping} onChange={setShipping} disabled={!editable} />
        </div>
      </div>
      <p className="text-sm">Place of supply: {data.posStateName || "Not set"} {data.posStateCode || ""}</p>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={`${line.sku}-${index}`} className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-6">
            <Input value={line.name} disabled={!editable} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
            <Input placeholder="HSN" value={line.hsn ?? ""} disabled={!editable} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, hsn: event.target.value } : item))} />
            <Input placeholder="Rate %" value={line.rateBps == null ? "" : String(line.rateBps / 100)} disabled={!editable} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, rateBps: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100) } : item))} />
            <p className="text-sm">Qty {line.quantity}</p>
            <p className="text-sm">{line.variant || line.sku || ""}</p>
            <p className="text-sm">{rupees(line.lineTotalPaise)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">Pricing
          <select className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2" value={pricing} disabled={!editable} onChange={(event) => setPricing(event.target.value as "INCLUSIVE" | "EXCLUSIVE")}>
            <option value="EXCLUSIVE">GST exclusive</option>
            <option value="INCLUSIVE">GST inclusive</option>
          </select>
        </label>
        <label className="text-sm">Customer shipping (₹)
          <Input className="mt-1" value={shippingAmount} disabled={!editable} onChange={(event) => setShippingAmount(event.target.value)} />
        </label>
        <label className="text-sm">Shipping GST %
          <Input className="mt-1" value={shippingRate} disabled={!editable || !shippingTaxable} onChange={(event) => setShippingRate(event.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={shippingTaxable} disabled={!editable} onChange={(event) => setShippingTaxable(event.target.checked)} />
        Shipping is taxable
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={recalculate} disabled={!editable || data.taxSource !== "IMPORTED"} onChange={(event) => setRecalculate(event.target.checked)} />
        Recalculate tax instead of keeping the imported Shopify amounts
      </label>
      <div className="text-sm">
        <p>Total {rupees(data.grandTotalPaise)}</p>
        <p>CGST {rupees(data.cgstPaise)} · SGST {rupees(data.sgstPaise)} · UTGST {rupees(data.utgstPaise)} · IGST {rupees(data.igstPaise)}</p>
        <p>Paid {rupees(data.amountPaidPaise)} · COD to collect {rupees(data.codCollectPaise)}</p>
        <div className="flex items-center gap-2">Payment {data.paymentMethod} <StatusBadge value={data.paymentStatus} /></div>
      </div>
    </div>
  );
}

function PartyFields({ title, party, onChange, disabled }: { title: string; party: PartySnapshot; onChange: (party: PartySnapshot) => void; disabled: boolean }) {
  const field = (key: keyof PartySnapshot, label: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={party[key]} disabled={disabled} onChange={(event) => onChange({ ...party, [key]: event.target.value })} />
    </div>
  );
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="font-medium">{title}</p>
      {field("name", "Name")}
      {field("company", "Company")}
      {field("line1", "Address line 1")}
      {field("line2", "Address line 2")}
      {field("city", "City")}
      {field("state", "State")}
      {field("stateCode", "State code")}
      {field("pincode", "PIN code")}
      {field("phone", "Mobile")}
      {field("email", "Email")}
      {field("gstin", "GSTIN")}
    </div>
  );
}
