"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  CircleDollarSign,
  Radio,
  ShoppingBag,
  Store,
  type LucideIcon,
} from "lucide-react";
import {
  CodMixChart,
  RevenueChart,
  ShipmentsHistogram,
  SourceMixChart,
} from "@/components/dashboard/analytics-charts";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useAnalytics } from "@/lib/hooks/use-analytics";
import { cn } from "@/lib/utils";
import type { AnalyticsPeriodKpi, AnalyticsRange } from "@/types/api";

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
];

function liveLabel(updatedAt: number, now: number) {
  if (!updatedAt) return "Waiting for first snapshot";
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return "Live · updated just now";
  if (seconds < 60) return `Live · updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Live · updated ${minutes}m ago`;
}

function PeriodCard({
  label,
  period,
  active,
  loading,
}: {
  label: string;
  period?: AnalyticsPeriodKpi;
  active: boolean;
  loading: boolean;
}) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-colors",
        active && "border-brand/30 bg-brand/[0.025]"
      )}
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 bg-transparent",
          active && "bg-brand"
        )}
      />
      <CardHeader className="gap-3 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <CardDescription className="font-medium text-foreground">{label}</CardDescription>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-soft text-muted">
            <CalendarDays className="size-4" />
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-36" />
        ) : (
          <CardTitle className="truncate text-2xl tabular-nums sm:text-[1.7rem]">
            {formatCurrency(period?.revenue)}
          </CardTitle>
        )}
        <p className="text-xs text-muted">Revenue · non-cancelled orders</p>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 border-t border-border p-4 sm:px-6">
        <MiniMetric label="Shipments" value={formatNumber(period?.shipments)} />
        <MiniMetric label="Orders" value={formatNumber(period?.orders)} />
        <MiniMetric label="COD" value={formatNumber(period?.codOrders)} />
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-medium uppercase text-muted">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function InsightCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "brand" | "warning";
  loading: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start gap-4 p-5 sm:p-6">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl",
            tone === "warning"
              ? "bg-warning/15 text-amber-700 dark:text-amber-400"
              : "bg-brand/10 text-brand"
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <CardDescription className="font-medium">{label}</CardDescription>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-28" />
          ) : (
            <CardTitle className="mt-1 truncate text-2xl tabular-nums">{value}</CardTitle>
          )}
          {hint ? <p className="mt-2 text-sm leading-5 text-muted">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const analytics = useAnalytics();
  const [range, setRange] = useState<AnalyticsRange>("today");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const data = analytics.data;
  const series = data?.series[range] ?? [];
  const sources = data?.sources[range] ?? [];
  const period = data?.[range];
  const prepaidOrders = Math.max(0, (period?.orders ?? 0) - (period?.codOrders ?? 0));
  const hasActivity = Boolean(data && (data.year.orders > 0 || data.year.shipments > 0));
  const selectedRangeLabel = RANGES.find((item) => item.id === range)?.label ?? "Selected period";

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title="Analytics"
        description="Live revenue, shipment volume, sources, and COD for this workspace."
        className="gap-5"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-medium text-muted sm:justify-start"
              )}
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              {analytics.isError ? "Live feed paused" : liveLabel(analytics.dataUpdatedAt, now)}
            </span>
            <Select value={range} onValueChange={(value) => setRange(value as AnalyticsRange)}>
              <SelectTrigger className="w-full bg-card sm:w-[170px]">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {analytics.isError ? (
        <EmptyState
          icon={Radio}
          title="Analytics unavailable"
          description={analytics.error instanceof Error ? analytics.error.message : "Try again shortly."}
        />
      ) : (
        <>
          <section aria-labelledby="performance-heading" className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                  Performance
                </p>
                <h2 id="performance-heading" className="mt-1 text-lg font-semibold text-ink">
                  Revenue overview
                </h2>
              </div>
              <p className="hidden text-sm text-muted sm:block">All times in Asia/Kolkata</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <PeriodCard
                label="Today"
                period={data?.today}
                active={range === "today"}
                loading={analytics.isLoading && !data}
              />
              <PeriodCard
                label="This month"
                period={data?.month}
                active={range === "month"}
                loading={analytics.isLoading && !data}
              />
              <PeriodCard
                label="This year"
                period={data?.year}
                active={range === "year"}
                loading={analytics.isLoading && !data}
              />
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            {analytics.isLoading && !data
              ? Array.from({ length: 2 }, (_, index) => (
                  <Card key={index}>
                    <CardContent className="p-6">
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))
              : (
                <>
                  <InsightCard
                    icon={CircleDollarSign}
                    label={`COD · ${selectedRangeLabel}`}
                    value={formatNumber(period?.codOrders)}
                    hint={`${formatCurrency(period?.codAmount)} cash-on-delivery order value`}
                    tone="warning"
                    loading={analytics.isLoading && !data}
                  />
                  <InsightCard
                    icon={Store}
                    label="Top order source · This year"
                    value={data?.topSource?.label ?? "—"}
                    hint={
                      data?.topSource
                        ? `${formatNumber(Math.round(data.topSource.share))}% of orders · ${formatNumber(data.topSource.orders)} total`
                        : "No source data available yet"
                    }
                    loading={analytics.isLoading && !data}
                  />
                </>
              )}
          </section>

          {analytics.isLoading && !data ? (
            <section className="grid gap-4 xl:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Card key={index}>
                  <CardHeader>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-72 w-full" />
                  </CardContent>
                </Card>
              ))}
            </section>
          ) : !hasActivity ? (
            <EmptyState
              icon={ShoppingBag}
              title="No analytics yet"
              description="Import Shopify orders or add a manual order to see revenue, sources, and shipment histograms."
            />
          ) : (
            <section aria-labelledby="charts-heading" className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
                  Trends
                </p>
                <h2 id="charts-heading" className="mt-1 text-lg font-semibold text-ink">
                  {selectedRangeLabel} breakdown
                </h2>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <RevenueChart data={series} />
                <ShipmentsHistogram data={series} />
                <SourceMixChart data={sources} />
                <CodMixChart
                  series={series}
                  codOrders={period?.codOrders ?? 0}
                  prepaidOrders={prepaidOrders}
                />
              </div>
            </section>
          )}
        </>
      )}

      {data?.truncated ? (
        <p className="text-sm text-muted">
          Showing the first 5,000 rows from this year. Older records beyond that cap are not included.
        </p>
      ) : null}
    </div>
  );
}
