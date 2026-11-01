"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, CheckCircle2, Circle, RefreshCw, Sparkles } from "lucide-react";
import { FEATURES, SETUP_STEP_COPY, type FeatureKey } from "@/components/ai-accountant/features";
import { useAccountantStatus, useReadOnly, type AccountantStatus } from "@/components/ai-accountant/shell";
import { HelpHint, Kpi, Money, Notes, presetPeriods, qs } from "@/components/ai-accountant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Overview = {
  period: { label: string };
  pnl: { revenuePaise: number; netProfitPaise: number; grossMarginBps: number | null; completeness: string; notes: string[] };
  cod: { unmatched: number; needsReview: number };
  gst: { registered: boolean | null; outputThisMonthPaise: number; inputThisMonthPaise: number };
};

type Pnl = { series: Array<{ month: string; revenuePaise: number; expensePaise: number; netProfitPaise: number }> };

const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--ink)", fontSize: 12 };

const QUICK_QUESTIONS = ["What was my net profit last month?", "How much GST will I owe this month?", "Which COD payments need attention?"];

/** One live status line per tool so merchants see what needs doing without opening each page. */
function toolStatus(key: FeatureKey, status?: AccountantStatus, overview?: Overview): { text: string; warn?: boolean; neutral?: boolean } | null {
  if (!status) return null;
  switch (key) {
    case "assistant":
      return { text: `${status.quota.remaining} of ${status.quota.included} questions left this period`, warn: status.quota.remaining === 0 };
    case "reports":
      return overview ? { text: overview.pnl.completeness === "INCOMPLETE" ? "Profit not verified yet: add costs" : "Profit verified for this month", warn: overview.pnl.completeness === "INCOMPLETE" } : null;
    case "ledger":
      return { text: status.lastSyncedAt ? `Last synced ${formatDate(status.lastSyncedAt, true)}` : "Not synced yet", warn: !status.lastSyncedAt };
    case "gst":
      if (!status.gst.registered) return { text: "GST registration not confirmed", warn: true };
      if (status.counts.productsMissingRate) return { text: `${status.counts.productsMissingRate} products without a GST rate`, warn: true };
      if (status.counts.productsMissingCost) return { text: `${status.counts.productsMissingCost} products without a unit cost`, warn: true };
      return { text: `GSTIN ${status.gst.gstin ?? ""}` };
    case "cod":
      return status.counts.codToReview ? { text: `${status.counts.codToReview} rows need review`, warn: true } : { text: "Nothing to review" };
    case "expenses":
      return { text: "Add bills as you pay them to claim GST credit", neutral: true };
    case "settings":
      return { text: `Setup ${status.setup.done} of ${status.setup.total} done`, warn: status.setup.done < status.setup.total };
    default:
      return null;
  }
}

export default function AiAccountantOverviewPage() {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const fy = presetPeriods().this_fy;
  const status = useAccountantStatus();
  const overview = useQuery({ queryKey: ["ai-accountant", "overview"], queryFn: () => api<Overview>("/api/v1/ai-accountant") });
  const trend = useQuery({
    queryKey: ["ai-accountant", "pnl", fy.from, fy.to],
    queryFn: () => api<Pnl>(`/api/v1/ai-accountant/reports/pnl${qs({ from: fy.from, to: fy.to })}`),
  });
  const sync = useMutation({
    mutationFn: () => api<{ posted: number; failed: number }>("/api/v1/ai-accountant/ledger/sync", { method: "POST", body: "{}" }),
    onSuccess: (data) => {
      toast.success(`Ledger updated: ${data.posted} new entries${data.failed ? `, ${data.failed} need attention` : ""}.`);
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = overview.data;
  const s = status.data;
  if (overview.isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (!data) return <p className="text-sm text-muted">{overview.error?.message ?? "Could not load your books."}</p>;

  const netGst = data.gst.outputThisMonthPaise - data.gst.inputThisMonthPaise;
  const codOpen = data.cod.unmatched + data.cod.needsReview;
  const chart = (trend.data?.series ?? []).map((row) => ({
    month: row.month,
    Revenue: row.revenuePaise / 100,
    Expenses: row.expensePaise / 100,
    Profit: row.netProfitPaise / 100,
  }));
  const setupLeft = s ? s.setup.steps.filter((step) => !step.done) : [];

  return (
    <div className="space-y-4">
      {s && setupLeft.length ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">
                  Finish setup · {s.setup.done} of {s.setup.total} done
                </p>
                <p className="text-xs text-muted">Figures stay marked “not verified” until these are done.</p>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft sm:w-48">
                <div className="h-full bg-brand transition-all" style={{ width: `${(s.setup.done / s.setup.total) * 100}%` }} />
              </div>
            </div>
            {s.setup.steps.some((step) => step.done) ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {s.setup.steps
                  .filter((step) => step.done)
                  .map((step) => (
                    <span key={step.key} className="inline-flex items-center gap-1">
                      <CheckCircle2 className="size-3.5 text-emerald-600" /> {SETUP_STEP_COPY[step.key]!.title}
                    </span>
                  ))}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {setupLeft.map((step) => {
                const copy = SETUP_STEP_COPY[step.key]!;
                const isSync = step.key === "sync";
                return (
                  <div key={step.key} className="flex items-start gap-2 rounded-xl border border-border p-3">
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium text-ink">{copy.title}</p>
                      <p className="text-xs text-muted">{copy.why}</p>
                      {isSync ? (
                        <Button size="xs" variant="secondary" disabled={readOnly || sync.isPending} onClick={() => sync.mutate()}>
                          <RefreshCw className={cn("size-3.5", sync.isPending && "animate-spin")} /> {copy.cta}
                        </Button>
                      ) : (
                        <Link href={copy.href} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                          {copy.cta} <ArrowRight className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {data.period.label} · {s?.lastSyncedAt ? `synced ${formatDate(s.lastSyncedAt, true)}, then daily` : "not synced yet"}
        </p>
        <Button size="xs" variant="secondary" disabled={readOnly || sync.isPending} onClick={() => sync.mutate()}>
          <RefreshCw className={cn("size-3.5", sync.isPending && "animate-spin")} /> Sync now
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Revenue" value={<Money paise={data.pnl.revenuePaise} />} hint="Net of GST, after RTO" />
        <Kpi
          label="Net profit"
          value={<Money paise={data.pnl.netProfitPaise} />}
          tone={data.pnl.completeness === "INCOMPLETE" ? "warn" : data.pnl.netProfitPaise >= 0 ? "good" : "bad"}
          hint={
            data.pnl.completeness === "INCOMPLETE"
              ? "Not verified: costs missing"
              : data.pnl.grossMarginBps !== null
                ? `Gross margin ${(data.pnl.grossMarginBps / 100).toFixed(1)}%`
                : undefined
          }
        />
        <Kpi label="COD to review" value={codOpen} tone={codOpen ? "warn" : "good"} hint={`${data.cod.unmatched} unmatched · ${data.cod.needsReview} mismatched`} />
        <Kpi
          label="GST payable (draft)"
          value={data.gst.registered ? formatPaise(Math.max(0, netGst)) : "—"}
          hint={data.gst.registered ? `Output ${formatPaise(data.gst.outputThisMonthPaise)} − credit ${formatPaise(data.gst.inputThisMonthPaise)}` : "GST registration not confirmed"}
        />
      </div>
      <Notes notes={data.pnl.notes} />

      <section aria-labelledby="tools-heading" className="space-y-2">
        <h2 id="tools-heading" className="flex items-center gap-1 text-sm font-semibold text-ink">
          Your tools
          <HelpHint label="tools">Each card shows what the tool does and what needs your attention right now.</HelpHint>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURES.filter((f) => f.key !== "overview").map((feature) => {
            const line = toolStatus(feature.key, s, data);
            return (
              <Link
                key={feature.key}
                href={feature.href}
                className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-surface-soft/40"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-surface-soft text-brand">
                    <feature.icon className="size-4" />
                  </span>
                  <span className="font-medium text-ink">{feature.label}</span>
                  <ArrowRight className="ml-auto size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="line-clamp-2 text-xs text-muted">{feature.summary}</p>
                {line ? (
                  <p
                    className={cn(
                      "mt-auto text-xs font-medium",
                      line.warn ? "text-amber-700 dark:text-amber-300" : line.neutral ? "text-muted" : "text-emerald-700 dark:text-emerald-300"
                    )}
                  >
                    {line.text}
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold text-ink">This financial year</p>
            <div className="h-64">
              {chart.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} width={80} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
                    <Bar dataKey="Revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Profit" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-16 text-center text-sm text-muted">Monthly figures appear after your first sync.</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles className="size-4 text-brand" /> Ask your accountant
            </p>
            <p className="text-xs text-muted">Answers come only from your books and say when a figure isn&apos;t verified.</p>
            <div className="flex flex-col gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <Link
                  key={q}
                  href={`/dashboard/ai-accountant/assistant${qs({ q })}`}
                  className="rounded-xl border border-border px-3 py-2 text-sm text-ink hover:bg-surface-soft"
                >
                  {q}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
