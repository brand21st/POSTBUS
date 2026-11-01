"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { api } from "@/lib/hooks/use-api";
import { createClient } from "@/lib/supabase/client";
import { formatBasisPoints, formatPaiseInr } from "@/modules/affiliates/policy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Row = Record<string, unknown>;
type Profile = {
  id: string;
  status: string;
  rejection_reason?: string;
  application: Record<string, string>;
};
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

const TABS = [
  ["overview", "Overview"],
  ["links", "Referral links"],
  ["referrals", "Referrals"],
  ["commissions", "Commissions"],
  ["payouts", "Payouts"],
  ["profile", "Profile"],
] as const;

function PerformanceCharts({ summary }: { summary: Summary }) {
  const weeks = new Map<string, number>();
  const months = new Map<string, { conversions: number; earnings: bigint }>();
  for (const row of summary.activity || []) {
    const date = new Date(row.day);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString().slice(0, 10);
    weeks.set(week, (weeks.get(week) || 0) + Number(row.signups));
    const month = row.day.slice(0, 7);
    const value = months.get(month) || { conversions: 0, earnings: BigInt(0) };
    value.conversions += Number(row.conversions);
    value.earnings += BigInt(row.earnings);
    months.set(month, value);
  }
  const charts = [
    { title: "Weekly merchant signups", data: [...weeks].map(([period, value]) => ({ period, value })) },
    { title: "Monthly paid subscriptions", data: [...months].map(([period, value]) => ({ period, value: value.conversions })) },
    { title: "Monthly recurring earnings (INR)", data: [...months].map(([period, value]) => ({ period, value: Number(value.earnings) / 100 })) },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {charts.map((chart) => (
        <Card key={chart.title}>
          <CardHeader>
            <CardTitle className="text-base">{chart.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart.data}>
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip />
                  <Area dataKey="value" stroke="#e11d48" fill="#ffe4e6" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function money(value: unknown) {
  return formatPaiseInr(value);
}

export function Field({
  name,
  label,
  type = "text",
  defaultValue = "",
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Input name={name} type={type} defaultValue={defaultValue} required={required} />
    </label>
  );
}

export function RecordTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="p-6 text-sm text-muted">No records yet.</p>;
  const keys = Object.keys(rows[0]).filter((key) => !key.endsWith("_id") && !["policy_snapshot", "application", "details", "encrypted_details"].includes(key));
  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {keys.map((key) => (
              <th className="border-b p-3 text-xs uppercase tracking-wide text-muted" key={key}>
                {key.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {keys.map((key) => (
                <td className="max-w-xs border-b p-3 break-words" key={key}>
                  {key.endsWith("paise")
                    ? money(row[key])
                    : key.endsWith("_at")
                      ? row[key]
                        ? new Date(String(row[key])).toLocaleString()
                        : "—"
                      : typeof row[key] === "object"
                        ? "—"
                        : String(row[key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Application({
  profile,
  email,
  onSave,
  pending,
}: {
  profile?: Profile;
  email?: string;
  onSave: (data: Row) => void;
  pending: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    onSave({ ...data, terms: data.terms === "on", notify: data.notify === "on", country: "IN" });
  }
  const fields: [string, string][] = [
    ["fullName", "Full name"],
    ["mobile", "Mobile number"],
    ["business", "Business / agency (optional)"],
    ["website", "Website (optional)"],
    ["social", "Social profile (optional)"],
    ["channel", "Promotional channel"],
    ["state", "State"],
    ["city", "City"],
  ];
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      {email ? <p className="text-sm sm:col-span-2">Account email: {email}. This stays on your PostBus login.</p> : null}
      {fields.map(([name, label]) => (
        <Field key={name} name={name} label={label} defaultValue={profile?.application[name]} required={!["business", "website", "social"].includes(name)} />
      ))}
      <p className="text-sm text-muted">Country: India. Settlement currency: INR.</p>
      <label className="flex items-center gap-2 text-sm">
        <input name="notify" type="checkbox" defaultChecked={String(profile?.application.notify ?? "true") !== "false"} />
        Email me when an application status changes.
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input name="terms" type="checkbox" required />
        I accept the <Link className="underline" href="/partner/terms">partner terms</Link>.
      </label>
      <Button disabled={pending}>{profile ? "Save profile" : "Submit application"}</Button>
    </form>
  );
}

export function PartnerDashboard() {
  const client = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const [page, setPage] = useState(0);
  const [days, setDays] = useState(30);
  const [range, setRange] = useState({ from: "", to: "" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [today] = useState(() => Date.now());
  const me = useQuery({
    queryKey: ["partner", "me"],
    queryFn: () =>
      api<{
        profile: Profile | null;
        email?: string;
        payoutsEnabled: boolean;
        settings: { minimum_payout_paise: number; hold_days: number; attribution_days: number; registration_open: boolean; default_basis_points: number | null } | null;
      }>("/api/partner/me"),
    retry: false,
  });
  const from = range.from ? new Date(range.from).toISOString() : new Date(today - days * 86400000).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const to = range.to ? new Date(range.to + "T23:59:59.999Z").toISOString() : new Date(today).toISOString().slice(0, 10) + "T23:59:59.999Z";
  const summary = useQuery({
    queryKey: ["partner", "summary", from, to],
    queryFn: () => api<Summary>(`/api/partner/summary?from=${from}&to=${to}`),
    enabled: !!me.data?.profile,
    retry: false,
  });
  const list = useQuery({
    queryKey: ["partner", tab, page, query, status, from, to],
    queryFn: () =>
      api<Row[]>(
        `/api/partner/${tab}?page=${page}&q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&from=${encodeURIComponent(["referrals", "commissions"].includes(tab) ? from : "")}&to=${encodeURIComponent(["referrals", "commissions"].includes(tab) ? to : "")}`
      ),
    enabled: !!me.data?.profile && !["overview", "profile"].includes(tab),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({ path, data, method = "POST" }: { path: string; data: Row; method?: string }) =>
      api(`/api/partner/${path}`, { method, body: JSON.stringify(data) }),
    retry: false,
    onSuccess: () => {
      setNotice("Saved.");
      void client.invalidateQueries({ queryKey: ["partner"] });
    },
  });

  if (me.isLoading) return <Skeleton className="m-8 h-40" />;
  if (me.error) {
    return (
      <Card className="m-8 p-6">
        <p role="alert">{me.error.message}</p>
        <Link href="/partner/login" className="mt-3 inline-block underline">
          Sign in
        </Link>
      </Card>
    );
  }

  const profile = me.data?.profile;
  const s = summary.data;
  const settings = me.data?.settings;
  const rateLabel = settings?.default_basis_points == null ? "the current admin policy" : formatBasisPoints(settings.default_basis_points);
  const holdLabel = settings ? `${settings.hold_days} days` : "the configured hold";
  const minimumLabel = settings ? money(settings.minimum_payout_paise) : "the configured minimum";
  const windowLabel = settings ? `${settings.attribution_days} days` : "the configured window";
  const metrics = s
    ? [
        ["Referral visits", s.clicks],
        ["Unique visitors", s.visitors],
        ["Merchant signups", s.signups],
        ["Paid merchants", s.conversions],
        ["Visitor-to-paid conversion", s.visitors ? `${((s.conversions / s.visitors) * 100).toFixed(1)}%` : "0%"],
        ["Earned in range", money(s.earned)],
        ["Reversed", money(s.reversed || 0)],
        ["Pending", money(s.pending)],
        ["Available", money(s.balance.available)],
        ["Total paid", money(s.balance.paid)],
        ["Reserved", money(s.reserved)],
        ["Refund recovery", money(s.balance.recoverable)],
      ]
    : [];

  return (
    <main id="main-content" className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="font-semibold text-brand">
            PostBus Partners
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your partner dashboard</h1>
          <p className="mt-2 text-muted">Refer merchants. Track recurring earnings.</p>
        </div>
        <div className="flex items-center gap-3">
          {profile ? <span className="rounded-full bg-surface-soft px-4 py-2 text-sm font-medium">{profile.status}</span> : null}
          <Button
            variant="secondary"
            onClick={() => {
              void createClient().auth.signOut().then(() => {
                window.location.href = "/partner/login";
              });
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      {profile?.status === "REJECTED" && profile.rejection_reason ? <p role="status">Application rejected: {profile.rejection_reason}</p> : null}
      {mutation.error || notice ? <p role="status">{mutation.error?.message || notice}</p> : null}

      {!profile ? (
        <Card>
          <CardHeader>
            <CardTitle>Apply to become a partner</CardTitle>
            <CardDescription>Submit your details. Referral links are issued after approval.</CardDescription>
          </CardHeader>
          <CardContent>
            <Application email={me.data?.email} pending={mutation.isPending} onSave={(data) => mutation.mutate({ path: "application", data })} />
          </CardContent>
        </Card>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="Partner sections">
            {TABS.map(([id, label]) => (
              <Button
                key={id}
                variant={tab === id ? "primary" : "secondary"}
                onClick={() => {
                  setTab(id);
                  setPage(0);
                  setNotice("");
                }}
              >
                {label}
              </Button>
            ))}
          </nav>

          {tab === "overview" ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                {[7, 30, 90].map((value) => (
                  <Button
                    variant={days === value && !range.from && !range.to ? "primary" : "secondary"}
                    key={value}
                    onClick={() => {
                      setDays(value);
                      setRange({ from: "", to: "" });
                    }}
                  >
                    {value} days
                  </Button>
                ))}
                <label className="text-sm">
                  From
                  <Input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
                </label>
                <label className="text-sm">
                  To
                  <Input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
                </label>
              </div>
              {summary.error ? <p role="alert">{summary.error.message}</p> : null}
              {!s && !summary.error ? <Skeleton className="h-40" /> : null}
              {s ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {metrics.map(([label, value]) => (
                      <Card key={label}>
                        <CardHeader>
                          <CardDescription>{label}</CardDescription>
                          <CardTitle>{value}</CardTitle>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Referral visits</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={s.daily}>
                            <XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5, 10)} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Area dataKey="clicks" stroke="#e11d48" fill="#ffe4e6" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                  <PerformanceCharts summary={s} />
                </>
              ) : null}
              <p className="text-sm text-muted">
                {rateLabel} recurring commission on verified, tax-exclusive subscription revenue. Attribution lasts {windowLabel}. Earnings require tax review and a {holdLabel} hold. Payout requests stay unavailable. The minimum, when payouts open, is {minimumLabel}.
              </p>
            </>
          ) : null}

          {tab === "profile" ? (
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <Application
                  email={me.data?.email}
                  profile={profile}
                  pending={mutation.isPending}
                  onSave={(data) => mutation.mutate({ path: "profile", method: "PATCH", data })}
                />
              </CardContent>
            </Card>
          ) : null}

          {tab === "links" ? (
            <div className="space-y-4">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate({ path: "links", data: { campaign: new FormData(event.currentTarget).get("campaign") || "" } });
                }}
              >
                <Field name="campaign" label="Campaign name (leave empty to keep the primary link)" required={false} />
                <Button disabled={mutation.isPending || profile.status !== "APPROVED"}>Create referral link</Button>
              </form>
              {profile.status !== "APPROVED" ? <p className="text-sm text-muted">Referral links are issued after approval.</p> : null}
              {list.data?.map((row) => {
                const url = `${window.location.origin}/?ref=${row.code}`;
                return (
                  <Card key={String(row.id)}>
                    <CardHeader>
                      <CardTitle className="text-base">{String(row.campaign || "Primary referral link")}</CardTitle>
                      <CardDescription>{row.enabled === false ? "Inactive" : "Active"}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="break-all text-sm">{url}</p>
                      <div className="flex flex-wrap gap-4">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(url)
                              .then(() => setNotice("Link copied."))
                              .catch(() => setNotice("Copy failed. Select the link above."))
                          }
                        >
                          Copy link
                        </Button>
                        {(
                          [
                            ["WhatsApp", "https://wa.me/?text="],
                            ["Facebook", "https://www.facebook.com/sharer/sharer.php?u="],
                            ["LinkedIn", "https://www.linkedin.com/sharing/share-offsite/?url="],
                          ] as const
                        ).map(([name, base]) => (
                          <a key={name} href={base + encodeURIComponent(url)} target="_blank" rel="noopener noreferrer" className="underline">
                            {name}
                          </a>
                        ))}
                        <a href={`/api/partner/qr?code=${encodeURIComponent(String(row.code))}`} target="_blank" rel="noopener noreferrer" className="underline">
                          QR code
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : null}

          {tab === "payouts" ? (
            <Card>
              <CardHeader>
                <CardTitle>Payouts</CardTitle>
                <CardDescription>Payout requests are not open. No transfer is sent from this screen.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted">Available balance stays on Overview. Rows below are existing ledger records.</p>
              </CardContent>
            </Card>
          ) : null}

          {tab === "referrals" || tab === "commissions" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Search
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="text-sm">
                Status
                <Input
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(0);
                  }}
                  placeholder={tab === "commissions" ? "PENDING" : "ACTIVE"}
                />
              </label>
            </div>
          ) : null}

          {tab !== "overview" && tab !== "profile" && tab !== "links" ? (
            <Card>
              {list.isLoading ? <p className="p-6">Loading…</p> : list.error ? <p role="alert" className="p-6">{list.error.message}</p> : <RecordTable rows={list.data || []} />}
            </Card>
          ) : null}

          {tab !== "overview" && tab !== "profile" ? (
            <div className="flex items-center gap-3">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page + 1}</span>
              <Button variant="secondary" disabled={(list.data?.length || 0) < 25} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
