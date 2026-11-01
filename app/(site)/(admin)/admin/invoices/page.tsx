"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";

type InvoiceAdmin = {
  issuanceEnabled: boolean;
  migrationRequired: boolean;
  settings: { legal_name: string; address: string; gstin: string; numbering_prefix: string };
  capturedSubscriptionPayments: number;
  issuedInvoices: number;
  total: number;
  page: number;
  invoices: Array<{ id: string; invoice_number: string; organization_id: string; payment_id: string; plan_name?: string; gross_paise: number; total_tax_paise: number; issued_at: string; status: string; payment_reference?: string | null }>;
  audit: Array<{ action: string; created_at: string; actor_id: string | null; target_id: string | null }>;
};

export default function AdminInvoicesPage() {
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("");
  const [filters, setFilters] = useState({ q: "", organizationId: "", plan: "", from: "", to: "", page: 1, direction: "desc" });
  const query = useQuery({
    queryKey: ["admin", "tax-invoices", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.organizationId) params.set("organizationId", filters.organizationId);
      if (filters.plan) params.set("plan", filters.plan);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      params.set("page", String(filters.page));
      params.set("direction", filters.direction);
      return api<InvoiceAdmin>(`/api/admin/tax-invoices?${params.toString()}`);
    },
  });
  const save = useMutation({
    mutationFn: (body: Record<string, string>) => api("/api/admin/tax-invoices/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setNotice("Supplier settings saved. Issuance stays off until the environment flag is enabled."); void client.invalidateQueries({ queryKey: ["admin", "tax-invoices"] }); },
  });
  const issue = useMutation({
    mutationFn: (body: Record<string, string>) => api("/api/admin/tax-invoices/issue", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => setNotice(`Invoice ${(result as { invoiceNumber?: string }).invoiceNumber ?? ""} recorded.`),
  });
  const reconcile = useMutation({
    mutationFn: (paymentId: string) => api<{ category: string }>(`/api/admin/tax-invoices/reconcile?paymentId=${paymentId}`),
    onSuccess: (result) => setCategory(result.category),
  });
  const data = query.data;

  return <main id="main-content" className="space-y-6 p-4 md:p-8">
    <PageHeader title="Subscription tax invoices" description="Issued invoices are immutable snapshots. A preview is not a tax invoice." />
    <Card className="space-y-2 p-6 text-sm">
      <p>Issuance: {data?.issuanceEnabled ? "enabled in this environment" : "off"}</p>
      <p>Captured subscription payments: {data?.capturedSubscriptionPayments ?? 0}</p>
      <p>Issued tax invoices: {data?.issuedInvoices ?? 0}. A preview is not included in this count.</p>
      <p>Supplier GSTIN is entered here. It is not guessed. Customer GSTIN is optional and comes from the merchant billing profile.</p>
      {data?.migrationRequired ? <p role="alert">Invoice tables are not on this database yet.</p> : null}
    </Card>
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Supplier identity</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        save.mutate({ pin: String(form.get("pin")), legalName: String(form.get("legalName")), address: String(form.get("address")), gstin: String(form.get("gstin") ?? ""), prefix: String(form.get("prefix") || "PB") });
      }}>
        <label className="text-sm">Legal name<input name="legalName" defaultValue={data?.settings.legal_name ?? ""} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">GSTIN<input name="gstin" defaultValue={data?.settings.gstin ?? ""} maxLength={15} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm sm:col-span-2">Address<textarea name="address" defaultValue={data?.settings.address ?? ""} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">Number prefix<input name="prefix" defaultValue={data?.settings.numbering_prefix ?? "PB"} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">Admin action PIN<input name="pin" type="password" autoComplete="one-time-code" required className="mt-1 block w-full rounded-lg border p-2" /></label>
        <div className="sm:col-span-2"><Button type="submit" variant="secondary" disabled={save.isPending || data?.migrationRequired === true}>Save supplier settings</Button></div>
      </form>
    </Card>
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Issued invoices</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setFilters({ q: String(form.get("q") ?? ""), organizationId: String(form.get("organizationId") ?? ""), plan: String(form.get("plan") ?? ""), from: String(form.get("from") ?? ""), to: String(form.get("to") ?? ""), page: 1, direction: String(form.get("direction") ?? "desc") }); }}>
        <input name="q" placeholder="Invoice number or payment reference" className="rounded-lg border p-2" />
        <input name="organizationId" placeholder="Organization id" className="rounded-lg border p-2" />
        <input name="plan" placeholder="Plan name" className="rounded-lg border p-2" />
        <input name="from" type="date" className="rounded-lg border p-2" />
        <input name="to" type="date" className="rounded-lg border p-2" />
        <select name="direction" defaultValue="desc" className="rounded-lg border p-2"><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-muted"><th className="py-2">Number</th><th>Organization</th><th>Plan</th><th>Reference</th><th>Gross paise</th><th>GST paise</th><th>Status</th></tr></thead>
          <tbody>{(data?.invoices ?? []).map((row) => <tr key={row.id} className="border-t"><td className="py-2">{row.invoice_number}</td><td>{row.organization_id}</td><td>{row.plan_name}</td><td>{row.payment_reference ?? row.payment_id}</td><td>{row.gross_paise}</td><td>{row.total_tax_paise}</td><td>{row.status}</td></tr>)}</tbody>
        </table>
        {(data?.invoices ?? []).length === 0 ? <p className="mt-3 text-sm text-muted">No tax invoices have been issued.</p> : null}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button>
          <Button type="button" variant="secondary" disabled={filters.page * 10 >= (data?.total ?? 0)} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</Button>
        </div>
        <h3 className="mt-6 text-base font-semibold">Audit</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted">{(data?.audit ?? []).map((row) => <li key={`${row.action}-${row.created_at}-${row.target_id}`}>{row.created_at} · {row.action} · {row.target_id}</li>)}</ul>
      </div>
    </Card>
    <Card className="grid gap-4 p-6 sm:grid-cols-2">
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); issue.mutate({ pin: String(form.get("pin")), paymentId: String(form.get("paymentId")) }); }}>
        <h2 className="text-lg font-semibold">Issue one invoice</h2>
        <p className="text-sm text-muted">This stays refused while issuance is off, even if the other fields are complete.</p>
        <input name="paymentId" autoComplete="off" required placeholder="Payment ID" className="block w-full rounded-lg border p-2" />
        <input name="pin" type="password" autoComplete="one-time-code" required placeholder="Admin action PIN" className="block w-full rounded-lg border p-2" />
        <Button type="submit" disabled={issue.isPending || data?.migrationRequired === true || data?.issuanceEnabled === false}>Issue</Button>
      </form>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); reconcile.mutate(String(form.get("paymentId"))); }}>
        <h2 className="text-lg font-semibold">Read-only check</h2>
        <input name="paymentId" autoComplete="off" required placeholder="Payment ID" className="block w-full rounded-lg border p-2" />
        <Button type="submit" variant="secondary" disabled={reconcile.isPending}>Check</Button>
        {category ? <p>Result: {category}</p> : null}
      </form>
    </Card>
    <p role="status">{save.error?.message || issue.error?.message || reconcile.error?.message || notice}</p>
  </main>;
}
