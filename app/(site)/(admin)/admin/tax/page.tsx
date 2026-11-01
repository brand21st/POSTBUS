"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";

type Policy = {
  id: string;
  version: number;
  status: string;
  treatment: string;
  rate_basis_points: number | null;
  place_of_supply: string | null;
  effective_at: string;
  reason: string;
};

type TaxPayload = {
  automationEnabled: boolean;
  inclusiveLabelEnabled: boolean;
  migrationRequired: boolean;
  policies: Policy[];
  breakdowns: Array<{ id: string; payment_id: string; gross_paise: number; taxable_paise: number; total_tax_paise: number; policy_version: number }>;
};

export default function TaxPolicyPage() {
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["admin", "tax-policies"], queryFn: () => api<TaxPayload>("/api/admin/tax-policies") });
  const propose = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/admin/tax-policies/propose", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setNotice("Draft policy recorded. It does not change prices or create tax evidence."); void client.invalidateQueries({ queryKey: ["admin", "tax-policies"] }); },
  });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => api(`/api/admin/tax-policies/${path}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => { setNotice(`Recorded ${(result as { status?: string }).status ?? "update"}.`); void client.invalidateQueries({ queryKey: ["admin", "tax-policies"] }); },
  });
  const data = query.data;

  return <main id="main-content" className="space-y-6 p-4 md:p-8">
    <PageHeader title="Subscription tax policy" description="GST-inclusive plan prices stay unchanged. A draft policy cannot create tax evidence." />
    <Card className="space-y-2 p-6 text-sm">
      <p>Tax automation: {data?.automationEnabled ? "enabled in this environment" : "off"}</p>
      <p>Customer inclusive label: {data?.inclusiveLabelEnabled ? "enabled in this environment" : "off"}</p>
      <p>No GST rate is assumed. Approve a policy only after a tax advisor confirms the rate, place of supply, and whether one treatment covers every subscription customer.</p>
      {data?.migrationRequired ? <p role="alert">The tax policy tables are not on this database yet.</p> : null}
    </Card>
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Policies</h2>
      {query.isLoading ? <p>Loading…</p> : query.error ? <p role="alert">{query.error.message}</p> : <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-muted"><th className="py-2">Version</th><th>Status</th><th>Treatment</th><th>Rate (bp)</th><th>Supply</th><th>Effective</th><th></th></tr></thead>
          <tbody>{(data?.policies ?? []).map((policy) => <tr key={policy.id} className="border-t">
            <td className="py-2">{policy.version}</td><td>{policy.status}</td><td>{policy.treatment}</td><td>{policy.rate_basis_points ?? "—"}</td><td>{policy.place_of_supply ?? "—"}</td><td>{policy.effective_at}</td>
            <td>{policy.status === "DRAFT" ? <Button type="button" variant="secondary" onClick={() => { const pin = window.prompt("Admin action PIN"); if (pin) act.mutate({ path: "approve", body: { pin, policyId: policy.id } }); }}>Approve</Button> : policy.status === "APPROVED" ? <Button type="button" variant="secondary" onClick={() => { const pin = window.prompt("Admin action PIN"); if (pin) act.mutate({ path: "retire", body: { pin, policyId: policy.id } }); }}>Retire</Button> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </Card>
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Record a draft</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const treatment = String(form.get("treatment"));
        propose.mutate({
          pin: String(form.get("pin")),
          treatment,
          rateBasisPoints: treatment === "ZERO_RATED" ? 0 : Number(form.get("rateBasisPoints")),
          placeOfSupply: treatment === "ZERO_RATED" ? null : String(form.get("placeOfSupply")),
          effectiveAt: new Date(String(form.get("effectiveAt"))).toISOString(),
          reason: String(form.get("reason")),
        });
      }}>
        <label className="text-sm">Treatment<select name="treatment" className="mt-1 block w-full rounded-lg border p-2"><option value="SINGLE_RATE_INCLUSIVE">Single inclusive rate</option><option value="ZERO_RATED">Zero-rated, explicit</option></select></label>
        <label className="text-sm">Rate in basis points<input name="rateBasisPoints" type="number" min={1} max={9999} className="mt-1 block w-full rounded-lg border p-2" placeholder="Enter the approved rate" /></label>
        <label className="text-sm">Place of supply<select name="placeOfSupply" className="mt-1 block w-full rounded-lg border p-2"><option value="INTRA">Intra-state CGST + SGST</option><option value="INTER">Inter-state IGST</option></select></label>
        <label className="text-sm">Effective at<input name="effectiveAt" type="datetime-local" required className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm sm:col-span-2">Reason<input name="reason" autoComplete="off" required minLength={3} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">Admin action PIN<input name="pin" type="password" autoComplete="one-time-code" required className="mt-1 block w-full rounded-lg border p-2" /></label>
        <div className="flex items-end"><Button disabled={propose.isPending}>Save draft</Button></div>
      </form>
    </Card>
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Apply an approved policy to one payment</h2>
      <p className="mt-2 text-sm text-muted">This writes evidence only while tax automation is enabled. It does not change the captured amount. A conflicting existing tax row is left for review.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        act.mutate({ path: "apply", body: { pin: String(form.get("pin")), paymentId: String(form.get("paymentId")) } });
      }}>
        <label className="text-sm">Payment ID<input name="paymentId" autoComplete="off" required className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">Admin action PIN<input name="pin" type="password" autoComplete="one-time-code" required className="mt-1 block w-full rounded-lg border p-2" /></label>
        <div><Button variant="secondary" disabled={act.isPending}>Apply</Button></div>
      </form>
    </Card>
    <p role="status">{propose.error?.message || act.error?.message || notice}</p>
  </main>;
}
