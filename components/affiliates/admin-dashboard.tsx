"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, RecordTable, money } from "./partner-dashboard";
type Row = Record<string, unknown>;
const sections = ["partners", "applications", "referrals", "conversions", "commissions", "report", "campaigns", "policies", "settings", "reconciliation", "evidence", "audit"];
const overviewLabel: Record<string, string> = { partners: "Total affiliates", active: "Approved affiliates", applications: "Pending applications", links: "Active referral links", signups: "Referred merchants", paidMerchants: "Paid conversions", earned: "Commission accrued", paid: "Commission paid", liabilities: "Commission liabilities", review: "Needs review" };
export function AffiliateAdminDashboard() {
    const [section, setSection] = useState("partners");
    const [page, setPage] = useState(0);
    const [partner, setPartner] = useState("");
    const [action, setAction] = useState("status");
    const [notice, setNotice] = useState("");
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["admin-affiliates", section, page, partner], queryFn: () => api<Row[]>(`/api/admin/affiliates/${section}?page=${page}${partner ? `&partner=${encodeURIComponent(partner)}` : ""}`), retry: false });
    const overview = useQuery({ queryKey: ["admin-affiliates", "overview"], queryFn: () => api<Row>("/api/admin/affiliates/overview"), retry: false });
    const mutation = useMutation({ mutationFn: ({ path, pin, data }: {
            path: string;
            pin: string;
            data: Row;
        }) => api(`/api/admin/affiliates/${path}`, { method: "POST", body: JSON.stringify({ pin, data }) }), retry: false, onSuccess: () => { setNotice("Action recorded."); void client.invalidateQueries({ queryKey: ["admin-affiliates"] }); } });
    return <main id="main-content" className="space-y-6 p-4 md:p-8"><h1 className="text-3xl font-semibold">Affiliate management</h1><p className="text-muted">Review partners, verified earnings, and monthly manual payouts.</p>
 <div className="grid gap-4 sm:grid-cols-3">{Object.entries(overview.data || {}).map(([k, v]) => <Card className="p-4" key={k}><p className="text-sm text-muted">{overviewLabel[k] || k}</p><p className="text-2xl font-semibold">{["earned", "paid", "liabilities"].includes(k) ? money(v) : String(v)}</p></Card>)}</div>
 <nav aria-label="Affiliate management" className="flex flex-wrap gap-2">{sections.map(s => <Button variant={section === s ? "primary" : "secondary"} key={s} onClick={() => { setSection(s); setPage(0); }}>{s}</Button>)}</nav>
 <label className="block text-sm">Filter by partner ID (optional)<input className="ml-3 rounded-lg border p-2" value={partner} onChange={e => { setPartner(e.target.value); setPage(0); }}/></label>
 <Card>{query.isLoading ? <p className="p-6">Loading…</p> : query.error ? <p role="alert" className="p-6">{query.error.message}</p> : <RecordTable rows={query.data || []}/>}</Card>
 {section === "applications" && query.data?.map(row => <Card className="p-4" key={String(row.id)}><p className="font-medium">Application {String(row.id)}</p><dl className="grid gap-2 sm:grid-cols-2">{Object.entries((row.application || {}) as Row).map(([k, v]) => <div key={k}><dt className="text-sm text-muted">{k}</dt><dd>{String(v)}</dd></div>)}</dl></Card>)}
 <div className="flex gap-3"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page + 1}</span><Button variant="secondary" disabled={(query.data?.length || 0) < 25} onClick={() => setPage(page + 1)}>Next</Button><Button variant="secondary" onClick={() => { const rows = query.data || []; const keys = rows[0] ? Object.keys(rows[0]) : []; const safe = (v: unknown) => '"' + String(typeof v === "object" ? JSON.stringify(v) : v ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"'; const csv = [keys.map(safe).join(","), ...rows.map(r => keys.map(k => safe(r[k])).join(","))].join("\r\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `affiliate-${section}-page-${page + 1}.csv`; a.click(); URL.revokeObjectURL(url); }}>Export this page</Button></div>
 <Card className="space-y-4 p-6"><h2 className="text-xl font-semibold">Record an administrative action</h2><label className="block">Action<select className="ml-3 rounded-lg border p-2" value={action} onChange={e => setAction(e.target.value)}>{["status", "policy", "correction", "tax", "adjustment", "link", "settings"].map(a => <option key={a}>{a}</option>)}</select></label>
 <form key={action} className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const data: Row = { action, reason: f.reason }; if (action === "status")
        data.status = f.status; if (action === "correction")
        Object.assign(data, { affiliateId: f.affiliateId, linkId: f.linkId }); if (action === "policy")
        Object.assign(data, { affiliateId: f.affiliateId || null, linkId: f.linkId || null, basisPoints: Number(f.basisPoints), fixedPaise: f.fixedPaise ? Number(f.fixedPaise) : null }); if (action === "tax")
        Object.assign(data, { taxPaise: Number(f.taxPaise), refundedPaise: Number(f.refundedPaise), refundedTaxPaise: Number(f.refundedTaxPaise) }); if (action === "adjustment")
        Object.assign(data, { amountPaise: Number(f.amountPaise), key: crypto.randomUUID() }); if (action === "link")
        data.enabled = f.enabled === "true"; if (action === "settings")
        Object.assign(data, { registrationOpen: f.registrationOpen === "true", attributionDays: Number(f.attributionDays), holdDays: Number(f.holdDays), minimumPayoutPaise: Number(f.minimumPayoutPaise) }); if (action === "payout")
        Object.assign(data, { action: f.status, reference: f.reference || "" }); mutation.mutate({ path: `${action === "payout" ? "payouts" : "actions"}${f.id ? `/${f.id}` : ""}`, pin: String(f.pin), data }); }}>
 {!["policy", "settings"].includes(action) && <Field name="id" label={action === "tax" ? "Payment ID" : action === "payout" ? "Payout request ID" : action === "link" ? "Link ID" : "Partner ID"}/>}
 {action === "status" && <><label>Status<select name="status" className="block rounded-lg border p-2">{["APPROVED", "REJECTED", "SUSPENDED"].map(s => <option key={s}>{s}</option>)}</select></label><p className="text-sm text-muted">Choose APPROVED to approve a pending application or to reactivate a suspended partner. Rejection reason is shown to the applicant. Suspension reason stays in the audit log.</p></>}
 {action === "correction" && <><Field name="affiliateId" label="Correct partner ID"/><Field name="linkId" label="Correct referral link ID"/><p>Applies to future captured payments only. Existing earnings remain unchanged.</p></>}{action === "policy" && <><Field name="affiliateId" label="Partner ID (empty for default policy)" required={false}/><Field name="linkId" label="Campaign link ID (optional)" required={false}/><Field name="basisPoints" label="Rate in basis points (2000 = 20%)" type="number" defaultValue="2000"/><Field name="fixedPaise" label="Fixed commission in paise (optional)" type="number" required={false}/></>}
 {action === "tax" && <><p className="text-sm text-muted sm:col-span-2">Record only a tax amount taken from a platform subscription invoice, an approved PostBus tax policy, or a Razorpay tax breakup. Do not use a shipping invoice, and do not assume a GST rate. A conflicting amount is rejected and no commission is created.</p><Field name="taxPaise" label="Verified original tax (paise)" type="number"/><Field name="refundedPaise" label="Cumulative refund (paise)" type="number" defaultValue="0"/><Field name="refundedTaxPaise" label="Cumulative refunded tax (paise)" type="number" defaultValue="0"/></>}
 {action === "adjustment" && <Field name="amountPaise" label="Signed adjustment amount (paise)" type="number"/>}
 {action === "link" && <label>Link enabled<select name="enabled"><option value="false">Disabled</option><option value="true">Enabled</option></select></label>}
 {action === "settings" && <><label>Registration<select name="registrationOpen"><option value="true">Open</option><option value="false">Closed</option></select></label><Field name="attributionDays" label="Attribution window (days)" type="number" defaultValue="30"/><Field name="holdDays" label="Commission hold (days)" type="number" defaultValue="30"/><Field name="minimumPayoutPaise" label="Minimum payout (paise)" type="number" defaultValue="100000"/></>}
 {action === "payout" && <><label>Decision<select name="status" className="block rounded-lg border p-2">{["APPROVED", "REJECTED", "REVIEW", "PAID", "RETURNED"].map(s => <option key={s}>{s}</option>)}</select></label><Field name="reference" label="Verified settlement reference (required for paid)" required={false}/><p className="text-sm text-muted">Only mark paid after independently confirming the transfer. Keep uncertain transfers in review.</p></>}
 <Field name="reason" label="Reason / supporting evidence reference"/><Field name="pin" label="Admin action PIN" type="password"/><Button disabled={mutation.isPending}>Record action</Button>
 </form><p role="status">{mutation.error?.message || notice}</p></Card></main>;
}
