"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { AnalyticsSeriesPoint, AnalyticsSourceShare } from "@/types/api";

const BRAND = "#e11d48";
const SUCCESS = "#16a34a";
const WARNING = "#f59e0b";
const SOURCE_COLORS = [BRAND, "#0ea5e9", "#8b5cf6", "#14b8a6", "#f97316"];

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--ink)",
  fontSize: 12,
};

function hasValues(rows: Array<Record<string, number | string>>, keys: string[]) {
  return rows.some((row) => keys.some((key) => Number(row[key] ?? 0) > 0));
}

function ChartCard({
  title,
  description,
  children,
  empty,
  chartClassName = "h-[260px] sm:h-72",
}: {
  title: string;
  description: string;
  children: ReactNode;
  empty: boolean;
  chartClassName?: string;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="p-5 pb-4 sm:p-6 sm:pb-4">
        <CardTitle>{title}</CardTitle>
        <CardDescription className="leading-5">{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 p-3 pt-0 sm:p-6 sm:pt-0">
        {empty ? (
          <EmptyState
            icon={BarChart3}
            title="No data in this window"
            description="Orders and shipments will appear here as they come in."
            className="py-10 sm:py-14"
          />
        ) : (
          <div className={chartClassName}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function RevenueChart({ data }: { data: AnalyticsSeriesPoint[] }) {
  return (
    <ChartCard
      title="Revenue"
      description="Order value over time, excluding cancelled orders."
      empty={!hasValues(data, ["revenue"])}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} stopOpacity={0.28} />
              <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            width={68}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) =>
              Number(value) >= 1000 ? `${formatNumber(Math.round(Number(value) / 1000))}k` : formatNumber(value)
            }
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [formatCurrency(Number(value ?? 0)), "Revenue"]}
          />
          <Area type="monotone" dataKey="revenue" stroke={BRAND} fill="url(#revenueFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ShipmentsHistogram({ data }: { data: AnalyticsSeriesPoint[] }) {
  return (
    <ChartCard
      title="Shipments"
      description="Volume histogram for the selected window."
      empty={!hasValues(data, ["shipments"])}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            width={38}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [formatNumber(Number(value ?? 0)), "Shipments"]}
          />
          <Bar dataKey="shipments" fill={BRAND} radius={[8, 8, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function SourceMixChart({ data }: { data: AnalyticsSourceShare[] }) {
  return (
    <ChartCard
      title="Order sources"
      description="Which channel is sending the most orders."
      empty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={96}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [
              name === "orders" ? formatNumber(Number(value ?? 0)) : formatCurrency(Number(value ?? 0)),
              name === "orders" ? "Orders" : "Revenue",
            ]}
          />
          <Bar dataKey="orders" fill={BRAND} radius={[0, 8, 8, 0]} maxBarSize={22}>
            {data.map((row, index) => (
              <Cell key={row.source} fill={SOURCE_COLORS[index % SOURCE_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CodMixChart({
  series,
  codOrders,
  prepaidOrders,
}: {
  series: AnalyticsSeriesPoint[];
  codOrders: number;
  prepaidOrders: number;
}) {
  const pie = [
    { name: "COD", value: codOrders },
    { name: "Prepaid", value: prepaidOrders },
  ];
  const empty = !hasValues(series, ["cod", "prepaid"]) && codOrders + prepaidOrders === 0;

  return (
    <ChartCard
      title="COD vs prepaid"
      description="Cash-on-delivery share against prepaid orders."
      empty={empty}
      chartClassName="h-[430px] sm:h-[460px] lg:h-72"
    >
      <div className="grid h-full min-h-0 grid-rows-[160px_1fr] gap-3 lg:grid-cols-[170px_1fr] lg:grid-rows-1">
        <div className="relative min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={2}>
                <Cell fill={WARNING} />
                <Cell fill={SUCCESS} />
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [formatNumber(Number(value ?? 0)), String(name)]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums text-ink">{formatNumber(codOrders + prepaidOrders)}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Orders</span>
          </div>
        </div>
        <div className="min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                width={32}
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="cod" stackId="pay" fill={WARNING} name="COD" maxBarSize={28} />
              <Bar dataKey="prepaid" stackId="pay" fill={SUCCESS} name="Prepaid" radius={[8, 8, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartCard>
  );
}
