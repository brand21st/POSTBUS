"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { useReadOnly } from "@/components/ai-accountant/shell";
import { Kpi, Money, Notes, presetPeriods, qs } from "@/components/ai-accountant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";

type Overview = {
  accessMode: string;
  setup: { gstReady: boolean; costsReady: boolean; complete: boolean; booksAccurate: boolean };
  lastSyncedAt: string | null;
  period: { label: string };
  pnl: { revenuePaise: number; netProfitPaise: number; directCostPaise: number; operatingPaise: number; grossMarginBps: number | null; completeness: string; notes: string[] };
  cod: { unmatched: number; needsReview: number };
  gst: { registered: boolean | null; gstin: string | null; outputThisMonthPaise: number; inputThisMonthPaise: number };
};

type Pnl = { series: Array<{ month: string; revenuePaise: number; expensePaise: number; netProfitPaise: number }> };

const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--ink)", fontSize: 12 };

export default function AiAccountantOverviewPage() {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const fy = presetPeriods().this_fy;
  const overview = useQuery({ queryKey: ["ai-accountant"], queryFn: () => api<Overview>("/api/v1/ai-accountant") });
  const trend = useQuery({
    queryKey: ["ai-accountant", "pnl", fy.from, fy.to],
    queryFn: () => api<Pnl>(`/api/v1/ai-accountant/reports/pnl${qs({ from: fy.from, to: fy.to })}`),
  });
  const sync = useMutation({
    mutationFn: () => api<{ posted: number; skipped: number; failed: number }>("/api/v1/ai-accountant/ledger/sync", { method: "POST", body: "{}" }),
    onSuccess: (data) => {
      toast.success(`Ledger updated: ${data.posted} new entries${data.failed ? `, ${data.failed} need attention` : ""}.`);
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = overview.data;
  if (overview.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!data) return <p className="text-sm text-muted">{overview.error?.message ?? "Could not load your books."}</p>;

  const netGst = data.gst.outputThisMonthPaise - data.gst.inputThisMonthPaise;
  const checklist = [
    { done: data.setup.gstReady, label: "Confirm GST registration", href: "/dashboard/ai-accountant/settings" },
    { done: data.setup.costsReady, label: "Add product costs or purchases", href: "/dashboard/ai-accountant/expenses" },
    { done: Boolean(data.lastSyncedAt), label: "Sync orders and postage into the ledger", href: null },
    { done: data.cod.unmatched + data.cod.needsReview === 0, label: "Clear the COD review queue", href: "/dashboard/ai-accountant/cod" },
  ];
  const chart = (trend.data?.series ?? []).map((row) => ({
    month: row.month,
    Revenue: row.revenuePaise / 100,
    Expenses: row.expensePaise / 100,
    Profit: row.netProfitPaise / 100,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {data.period.label} · {data.lastSyncedAt ? `Ledger synced ${formatDate(data.lastSyncedAt, true)}` : "Ledger not synced yet"}
        </p>
        <Button size="sm" variant="secondary" disabled={readOnly || sync.isPending} onClick={() => sync.mutate()}>
          <RefreshCw className={sync.isPending ? "size-4 animate-spin" : "size-4"} />
          Sync ledger
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue this month" value={<Money paise={data.pnl.revenuePaise} />} hint="Net of GST, after RTO" />
        <Kpi
          label="Net profit this month"
          value={<Money paise={data.pnl.netProfitPaise} />}
          tone={data.pnl.completeness === "INCOMPLETE" ? "warn" : data.pnl.netProfitPaise >= 0 ? "good" : "bad"}
          hint={data.pnl.completeness === "INCOMPLETE" ? "Not verified: costs missing" : data.pnl.grossMarginBps !== null ? `Gross margin ${(data.pnl.grossMarginBps / 100).toFixed(1)}%` : undefined}
        />
        <Kpi
          label="COD rows to review"
          value={data.cod.unmatched + data.cod.needsReview}
          tone={data.cod.unmatched + data.cod.needsReview ? "warn" : "good"}
          hint={`${data.cod.unmatched} unmatched · ${data.cod.needsReview} mismatched`}
        />
        <Kpi
          label="GST this month (draft)"
          value={data.gst.registered ? formatPaise(Math.max(0, netGst)) : "Not registered"}
          hint={data.gst.registered ? `Output ${formatPaise(data.gst.outputThisMonthPaise)} − input ${formatPaise(data.gst.inputThisMonthPaise)}` : "Add your GSTIN in settings"}
        />
      </div>
      <Notes notes={data.pnl.notes} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>This financial year</CardTitle>
            <CardDescription>Monthly revenue, expenses and net profit from the ledger.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
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
              <p className="pt-10 text-center text-sm text-muted">Sync the ledger to see monthly figures.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Get accurate books</CardTitle>
            <CardDescription>Figures are marked unverified until these are done.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                {item.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted" />}
                {item.href && !item.done ? (
                  <Link href={item.href} className="text-ink underline-offset-4 hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className={item.done ? "text-muted line-through" : "text-ink"}>{item.label}</span>
                )}
              </div>
            ))}
            <Link href="/dashboard/ai-accountant/assistant" className="mt-3 block text-sm font-medium text-brand underline-offset-4 hover:underline">
              Ask the AI Accountant a question →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
