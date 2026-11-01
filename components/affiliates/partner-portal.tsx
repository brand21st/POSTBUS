"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link2, Wallet } from "lucide-react";
import { api } from "@/lib/hooks/use-api";
import { formatBasisPoints, formatPaiseInr, publicReferralPath } from "@/modules/affiliates/policy";
import { PartnerShell } from "@/components/affiliates/partner-shell";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";

type Row = Record<string, unknown>;
type Profile = { id: string; status: string; rejection_reason?: string; application: Record<string, string>; created_at?: string };
type Settings = { minimum_payout_paise: number; hold_days: number; attribution_days: number; registration_open: boolean; default_basis_points: number | null };
type Summary = {
  balance: { available: string; recoverable: string; paid: string };
  clicks: number;
  visitors: number;
  signups: number;
  conversions: number;
  earned: string;
  pending: string;
  reversed?: string;
  reserved: string;
  daily: { day: string; clicks: number }[];
  activity?: { day: string; signups: number; conversions: number; earnings: string }[];
};
type Me = { profile: Profile | null; email?: string; payoutsEnabled: boolean; settings: Settings | null };
type LinkRow = { id: string; code: string; campaign?: string; enabled?: boolean; landingPath?: string; landing_path?: string; utmSource?: string; utm_source?: string; utmMedium?: string; utm_medium?: string; utmCampaign?: string; utm_campaign?: string; clicks?: number; signups?: number; conversions?: number; created_at?: string };

function money(value: unknown) {
  return formatPaiseInr(value);
}

function statusLabel(status?: string) {
  if (status === "APPROVED") return "Active Partner";
  if (status === "PENDING") return "Pending Approval";
  if (status === "REJECTED") return "Rejected";
  if (status === "SUSPENDED") return "Suspended";
  return status || "Unknown";
}

function Field({ name, label, type = "text", defaultValue = "", required = true }: { name: string; label: string; type?: string; defaultValue?: string; required?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Input name={name} type={type} defaultValue={defaultValue} required={required} />
    </label>
  );
}

export { Field };

function rangeParams(days: number, custom: { from: string; to: string }) {
  const to = custom.to ? new Date(custom.to + "T23:59:59.999Z").toISOString() : new Date().toISOString();
  const from = custom.from ? new Date(custom.from).toISOString() : new Date(Date.now() - days * 86400000).toISOString();
  return { from, to };
}

function usePartnerMe() {
  return useQuery({ queryKey: ["partner", "me"], queryFn: () => api<Me>("/api/partner/me"), retry: false });
}

function Gate({ children }: { children: (me: Me) => ReactNode }) {
  const me = usePartnerMe();
  if (me.isLoading) return <Skeleton className="h-40" />;
  if (me.error) {
    return (
      <Card className="p-6">
        <p role="alert">{me.error.message}</p>
        <Link href="/partner/login" className="mt-3 inline-block underline">Sign in</Link>
      </Card>
    );
  }
  const data = me.data;
  if (!data) return null;
  return (
    <PartnerShell status={statusLabel(data.profile?.status)} email={data.email}>
      {!data.profile ? <ApplicationCard email={data.email} /> : children(data)}
    </PartnerShell>
  );
}

function ApplicationCard({ email, profile }: { email?: string; profile?: Profile }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: Row) => api(profile ? "/api/partner/profile" : "/api/partner/application", { method: profile ? "PATCH" : "POST", body: JSON.stringify(data) }),
    retry: false,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["partner"] }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    mutation.mutate({ ...data, terms: data.terms === "on", notify: data.notify === "on", country: "IN" });
  }
  const fields: [string, string, boolean][] = [
    ["fullName", "Full name", true],
    ["mobile", "Mobile number", true],
    ["business", "Business / agency", false],
    ["website", "Website", false],
    ["social", "Social profile", false],
    ["channel", "Promotional channel", true],
    ["state", "State", true],
    ["city", "City", true],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{profile ? "Profile" : "Apply to become a partner"}</CardTitle>
        <CardDescription>{profile ? "These details stay on your partner application." : "Referral links are issued after approval."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          {email ? <p className="text-sm sm:col-span-2">Account email: {email}</p> : null}
          {fields.map(([name, label, required]) => (
            <Field key={name} name={name} label={label} defaultValue={profile?.application[name]} required={required} />
          ))}
          <p className="text-sm text-muted">Country: India. Settlement currency: INR.</p>
          <label className="flex items-center gap-2 text-sm">
            <input name="notify" type="checkbox" defaultChecked={String(profile?.application.notify ?? "true") !== "false"} />
            Email me when an application status changes.
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input name="terms" type="checkbox" required defaultChecked={Boolean(profile)} />
            I accept the <Link className="underline" href="/partner/terms">partner terms</Link>.
          </label>
          <Button disabled={mutation.isPending}>{profile ? "Save profile" : "Submit application"}</Button>
          {mutation.error ? <p role="alert" className="sm:col-span-2">{mutation.error.message}</p> : null}
          {mutation.isSuccess ? <p role="status" className="sm:col-span-2">Saved.</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function DateRange({ days, setDays, custom, setCustom }: { days: number; setDays: (value: number) => void; custom: { from: string; to: string }; setCustom: (value: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {[7, 30, 90].map((value) => (
        <Button key={value} variant={days === value && !custom.from && !custom.to ? "primary" : "secondary"} onClick={() => { setDays(value); setCustom({ from: "", to: "" }); }}>
          {value} days
        </Button>
      ))}
      <label className="text-sm">From<Input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
      <label className="text-sm">To<Input type="date" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
    </div>
  );
}

function ChartCard({ title, data, dataKey }: { title: string; data: Row[]; dataKey: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="h-48">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <XAxis dataKey="period" tickFormatter={(value) => String(value).slice(5, 10)} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Area dataKey={dataKey} stroke="#e11d48" fill="#ffe4e6" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-muted">No activity in this range.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PartnerOverview() {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const { from, to } = rangeParams(days, custom);
  return (
    <Gate>
      {(me) => <OverviewBody me={me} from={from} to={to} days={days} setDays={setDays} custom={custom} setCustom={setCustom} />}
    </Gate>
  );
}

function OverviewBody({ me, from, to, days, setDays, custom, setCustom }: { me: Me; from: string; to: string; days: number; setDays: (value: number) => void; custom: { from: string; to: string }; setCustom: (value: { from: string; to: string }) => void }) {
  const summary = useQuery({ queryKey: ["partner", "summary", from, to], queryFn: () => api<Summary>(`/api/partner/summary?from=${from}&to=${to}`), retry: false });
  const s = summary.data;
  const rate = me.settings?.default_basis_points == null ? "the current admin policy" : formatBasisPoints(me.settings.default_basis_points);
  const conversion = s?.visitors ? `${((s.conversions / s.visitors) * 100).toFixed(1)}%` : "0%";
  const metrics = s
    ? [
        ["Total referral clicks", s.clicks],
        ["Unique visitors", s.visitors],
        ["Merchant signups", s.signups],
        ["Paid conversions", s.conversions],
        ["Conversion rate", conversion],
        ["Lifetime commissions (range)", money(s.earned)],
        ["Pending commission", money(s.pending)],
        ["Available balance", money(s.balance.available)],
        ["Total paid", money(s.balance.paid)],
        ["Reversed", money(s.reversed || 0)],
      ]
    : [];
  const activity = s?.activity || [];
  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome back, ${me.profile?.application.fullName || "Partner"}`} description="Track your referrals, commissions, and partner performance." />
      <p className="text-sm">{statusLabel(me.profile?.status)}</p>
      {me.profile?.status === "REJECTED" && me.profile.rejection_reason ? <p role="status">Application rejected: {me.profile.rejection_reason}</p> : null}
      <DateRange days={days} setDays={setDays} custom={custom} setCustom={setCustom} />
      {summary.isLoading ? <Skeleton className="h-40" /> : null}
      {summary.error ? <p role="alert">{summary.error.message}</p> : null}
      {s ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(([label, value]) => (
              <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Referral clicks" data={(s.daily || []).map((row) => ({ period: row.day, value: row.clicks }))} dataKey="value" />
            <ChartCard title="Merchant signups" data={activity.map((row) => ({ period: row.day, value: Number(row.signups) }))} dataKey="value" />
            <ChartCard title="Paid conversions" data={activity.map((row) => ({ period: row.day, value: Number(row.conversions) }))} dataKey="value" />
            <ChartCard title="Commission earnings (INR)" data={activity.map((row) => ({ period: row.day, value: Number(row.earnings) / 100 }))} dataKey="value" />
          </div>
        </>
      ) : null}
      <p className="text-sm text-muted">
        {rate} recurring commission on verified, tax-exclusive subscription revenue. Attribution lasts {me.settings ? `${me.settings.attribution_days} days` : "the configured window"}. Earnings require tax review and a {me.settings ? `${me.settings.hold_days}-day` : "configured"} hold. Figures refresh when you load or change the date range.
      </p>
    </div>
  );
}

function shareUrl(row: LinkRow) {
  if (typeof window === "undefined") return "";
  const landing = row.landingPath || row.landing_path || "/";
  return `${window.location.origin}${publicReferralPath(row.code, landing, { utmSource: row.utmSource || row.utm_source, utmMedium: row.utmMedium || row.utm_medium, utmCampaign: row.utmCampaign || row.utm_campaign })}`;
}

function LinksBody({ createCampaign }: { createCampaign: boolean }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["partner", "links"], queryFn: () => api<{ rows: LinkRow[] }>("/api/partner/links"), retry: false });
  const mutation = useMutation({
    mutationFn: (data: Row) => api(createCampaign ? "/api/partner/campaigns" : "/api/partner/links", { method: "POST", body: JSON.stringify(data) }),
    retry: false,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["partner", "links"] }),
  });
  const me = usePartnerMe();
  const approved = me.data?.profile?.status === "APPROVED";
  const rows = list.data?.rows || [];
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-6">
      <PageHeader title={createCampaign ? "Campaigns" : "Referral links"} description="Opaque 24-character codes. Landing pages stay on PostBus." />
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(Object.fromEntries(new FormData(event.currentTarget)));
        }}
      >
        <Field name="campaign" label={createCampaign ? "Campaign name" : "Campaign name (optional)"} required={createCampaign} />
        {createCampaign ? (
          <>
            <Field name="channel" label="Marketing channel" required={false} />
            <Field name="utmSource" label="UTM source" required={false} />
            <Field name="utmMedium" label="UTM medium" required={false} />
            <Field name="utmCampaign" label="UTM campaign" required={false} />
            <label className="grid gap-1 text-sm">
              Landing page
              <select name="landingPath" className="h-10 rounded-md border border-border bg-background px-3" defaultValue="/">
                <option value="/">Home</option>
                <option value="/pricing">Pricing</option>
                <option value="/partner">Partners</option>
              </select>
            </label>
          </>
        ) : null}
        <Button disabled={!approved || mutation.isPending}>{createCampaign ? "Create campaign link" : "Create referral link"}</Button>
      </form>
      {!approved ? <p className="text-sm text-muted">Referral links are issued after approval.</p> : null}
      {mutation.error ? <p role="alert">{mutation.error.message}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {list.isLoading ? <Skeleton className="h-40" /> : null}
      {list.error ? <p role="alert">{list.error.message}</p> : null}
      {!list.isLoading && !rows.length ? <EmptyState icon={Link2} title="No referral links yet" description="Create a campaign after approval." /> : null}
      {rows.map((row) => {
        const url = shareUrl(row);
        return (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="text-base">{row.campaign || "Primary referral link"}</CardTitle>
              <CardDescription>{row.enabled === false ? "Inactive" : "Active"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-all text-sm">{url}</p>
              <p className="text-sm text-muted">Clicks {row.clicks ?? "—"} · Signups {row.signups ?? "—"} · Paid {row.conversions ?? "—"}</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(url).then(() => setNotice("Link copied.")).catch(() => setNotice("Copy failed."))}>Copy link</Button>
                <a className="underline" href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                <a className="underline" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">Facebook</a>
                <a className="underline" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                <a className="underline" href={`/api/partner/qr?code=${encodeURIComponent(row.code)}`} target="_blank" rel="noopener noreferrer">QR code</a>
                <a className="underline" href={`/api/partner/qr?code=${encodeURIComponent(row.code)}`} download={`postbus-partner-${row.code}.png`}>Download QR</a>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function PartnerLinks() {
  return <Gate>{() => <LinksBody createCampaign={false} />}</Gate>;
}

export function PartnerCampaigns() {
  return <Gate>{() => <LinksBody createCampaign />}</Gate>;
}

function RecordsPage({ title, path, searchPlaceholder }: { title: string; path: "referrals" | "commissions"; searchPlaceholder: string }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(90);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const { from, to } = rangeParams(days, custom);
  const list = useQuery({
    queryKey: ["partner", path, page, query, status, from, to],
    queryFn: () => api<Row[]>(`/api/partner/${path}?page=${page}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&from=${from}&to=${to}`),
    retry: false,
  });
  const rows = Array.isArray(list.data) ? list.data : [];
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <Gate>
      {(me) => (
        <div className="space-y-6">
          <PageHeader title={title} description={path === "commissions" ? "Amounts come from the affiliate ledger. They are not summed in the browser." : "Merchant identity is a short attribution label, not an email or phone number."} />
          {path === "commissions" ? <CommissionStats from={from} to={to} /> : null}
          <DateRange days={days} setDays={setDays} custom={custom} setCustom={setCustom} />
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">Search<Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={searchPlaceholder} /></label>
            <label className="text-sm">Status<Input value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} placeholder={path === "commissions" ? "PENDING" : "PAID"} /></label>
          </div>
          <Card>
            {list.isLoading ? <p className="p-6">Loading…</p> : list.error ? <p role="alert" className="p-6">{list.error.message}</p> : !rows.length ? <p className="p-6 text-sm text-muted">No records in this range.</p> : (
              <div className="overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>{keys.map((key) => <th className="border-b p-3 text-xs uppercase tracking-wide text-muted" key={key}>{key.replaceAll("_", " ")}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={String(row.payment_reference ?? row.merchant ?? index)}>
                        {keys.map((key) => (
                          <td className="max-w-xs border-b p-3 break-words" key={key}>
                            {String(key).includes("paise") ? money(row[key]) : key.endsWith("_at") && row[key] ? new Date(String(row[key])).toLocaleString() : String(row[key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page + 1}</span>
            <Button variant="secondary" disabled={rows.length < 25} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
          {path === "commissions" ? <p className="text-sm text-muted">Statuses are PENDING, PAYABLE, PAID, and REVERSED. Future renewals are not shown as earnings. Hold: {me.settings?.hold_days ?? 30} days.</p> : null}
        </div>
      )}
    </Gate>
  );
}

function CommissionStats({ from, to }: { from: string; to: string }) {
  const summary = useQuery({ queryKey: ["partner", "summary", from, to], queryFn: () => api<Summary>(`/api/partner/summary?from=${from}&to=${to}`), retry: false });
  const s = summary.data;
  if (!s) return summary.isLoading ? <Skeleton className="h-24" /> : null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {[
        ["Earned in range", money(s.earned)],
        ["Pending", money(s.pending)],
        ["Available", money(s.balance.available)],
        ["Paid", money(s.balance.paid)],
        ["Reversed", money(s.reversed || 0)],
      ].map(([label, value]) => (
        <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>
      ))}
    </div>
  );
}

export function PartnerReferrals() {
  return <RecordsPage title="My referrals" path="referrals" searchPlaceholder="Merchant label" />;
}

export function PartnerCommissions() {
  return <RecordsPage title="Commissions" path="commissions" searchPlaceholder="Payment reference" />;
}

export function PartnerPayouts() {
  return (
    <Gate>
      {(me) => <PayoutsBody me={me} />}
    </Gate>
  );
}

function PayoutsBody({ me }: { me: Me }) {
  const summary = useQuery({ queryKey: ["partner", "summary", "payouts"], queryFn: () => api<Summary>(`/api/partner/summary?from=${new Date(Date.now() - 365 * 86400000).toISOString()}&to=${new Date().toISOString()}`), retry: false });
  const list = useQuery({ queryKey: ["partner", "payouts"], queryFn: () => api<Row[]>("/api/partner/payouts"), retry: false });
  const rows = list.data || [];
  return (
    <div className="space-y-6">
      <PageHeader title="Payouts" description="Fund transfers stay disabled in this phase." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardDescription>Available balance</CardDescription><CardTitle>{money(summary.data?.balance.available)}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Minimum payout</CardDescription><CardTitle>{money(me.settings?.minimum_payout_paise)}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Total paid</CardDescription><CardTitle>{money(summary.data?.balance.paid)}</CardTitle></CardHeader></Card>
      </div>
      <Card className="p-6">
        <p>Payout requests are not available yet.</p>
        <p className="mt-2 text-sm text-muted">POSTBUS_AFFILIATE_PAYOUTS_ENABLED is off. This screen does not send money.</p>
      </Card>
      {rows.length ? (
        <Card>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="border-b p-3">Amount</th><th className="border-b p-3">Status</th><th className="border-b p-3">Created</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={String(row.id ?? index)}>
                    <td className="border-b p-3">{money(row.amount_paise)}</td>
                    <td className="border-b p-3">{String(row.status)}</td>
                    <td className="border-b p-3">{row.created_at ? new Date(String(row.created_at)).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : <EmptyState icon={Wallet} title="No payout records" description="Existing ledger payouts would appear here. None are invented." />}
    </div>
  );
}

export function PartnerProfile() {
  return (
    <Gate>
      {(me) => (
        <div className="space-y-6">
          <PageHeader title="Profile" description="You cannot change approval status or commission rate." />
          <Card className="p-6 space-y-2 text-sm">
            <p>Affiliate identifier: {me.profile?.id}</p>
            <p>Status: {statusLabel(me.profile?.status)}</p>
            <p>Created: {me.profile?.created_at ? new Date(me.profile.created_at).toLocaleString() : "—"}</p>
            <p>Commission policy: {me.settings?.default_basis_points == null ? "admin policy" : formatBasisPoints(me.settings.default_basis_points)}</p>
            <p>Password and email changes use the same PostBus account: <Link className="underline" href="/forgot-password">reset password</Link></p>
          </Card>
          <ApplicationCard email={me.email} profile={me.profile || undefined} />
        </div>
      )}
    </Gate>
  );
}

export function PartnerSupport() {
  return (
    <Gate>
      {() => (
        <div className="space-y-6">
          <PageHeader title="Help & support" description="Partner program rules and account help." />
          <Card className="space-y-3 p-6 text-sm">
            <p>Commission is 20% of eligible net subscription revenue after verified tax evidence, unless Super Admin assigned a different policy.</p>
            <p>First-touch attribution lasts 30 days by default. Commissions hold 30 days. Minimum payout, when enabled, is ₹1,000.00.</p>
            <p>India Post bookings and merchant storefront payments do not earn commission.</p>
            <p><Link className="underline" href="/partner/terms">Partner terms</Link></p>
            <p><Link className="underline" href="/forgot-password">Reset password</Link></p>
          </Card>
        </div>
      )}
    </Gate>
  );
}

export function PartnerPendingBanner() {
  return <Badge variant="warning">Pending Approval</Badge>;
}
