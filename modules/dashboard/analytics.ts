import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import type {
  AnalyticsPeriodKpi,
  AnalyticsRange,
  AnalyticsSeriesPoint,
  AnalyticsSourceShare,
  DashboardAnalytics,
} from "@/types/api";

export const ANALYTICS_TIMEZONE = "Asia/Kolkata";
export const ANALYTICS_PAGE_SIZE = 1000;
export const ANALYTICS_MAX_ROWS = 5000;

export type AnalyticsOrderRow = {
  created_at: string;
  total_amount: number | string | null;
  source: string | null;
  payment_status: string | null;
  status: string | null;
};

export type AnalyticsShipmentRow = {
  created_at: string;
  payment_mode: string | null;
  cod_amount: number | string | null;
  status: string | null;
};

type IstParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  dateKey: string;
  monthKey: string;
};

const SOURCE_LABELS: Record<string, string> = {
  SHOPIFY: "Shopify",
  MANUAL: "Manual",
  API: "API",
  WOOCOMMERCE: "WooCommerce",
};

export function asAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isActiveOrder(row: Pick<AnalyticsOrderRow, "status">) {
  return (row.status ?? "").toUpperCase() !== "CANCELLED";
}

export function isCodOrder(row: Pick<AnalyticsOrderRow, "payment_status">) {
  return (row.payment_status ?? "").toUpperCase() === "COD";
}

export function isActiveShipment(row: Pick<AnalyticsShipmentRow, "status">) {
  return (row.status ?? "").toUpperCase() !== "CANCELLED";
}

export function isCodShipment(row: Pick<AnalyticsShipmentRow, "payment_mode">) {
  return (row.payment_mode ?? "").toUpperCase() === "COD";
}

export function istParts(value: string | Date, timeZone = ANALYTICS_TIMEZONE): IstParts {
  const date = value instanceof Date ? value : new Date(value);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year,
    month,
    day,
    hour,
    dateKey: `${bag.year}-${bag.month}-${bag.day}`,
    monthKey: `${bag.year}-${bag.month}`,
  };
}

export function startOfIstYearIso(now: Date, timeZone = ANALYTICS_TIMEZONE) {
  const parts = istParts(now, timeZone);
  return new Date(`${parts.year}-01-01T00:00:00+05:30`).toISOString();
}

export function emptyPeriod(): AnalyticsPeriodKpi {
  return { shipments: 0, revenue: 0, orders: 0, codOrders: 0, codAmount: 0 };
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source;
}

function monthLabel(month: number) {
  return new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-IN", { month: "short" });
}

function inRange(parts: IstParts, now: IstParts, range: AnalyticsRange) {
  if (parts.year !== now.year) return false;
  if (range === "year") return true;
  if (parts.month !== now.month) return false;
  if (range === "month") return true;
  return parts.day === now.day;
}

function buildSeries(now: IstParts): Record<AnalyticsRange, AnalyticsSeriesPoint[]> {
  const today = Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour).padStart(2, "0"),
    label: `${String(hour).padStart(2, "0")}:00`,
    revenue: 0,
    shipments: 0,
    orders: 0,
    cod: 0,
    prepaid: 0,
  }));
  const month = Array.from({ length: now.day }, (_, index) => {
    const day = index + 1;
    return {
      key: `${now.year}-${String(now.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      label: String(day),
      revenue: 0,
      shipments: 0,
      orders: 0,
      cod: 0,
      prepaid: 0,
    };
  });
  const year = Array.from({ length: now.month }, (_, index) => {
    const monthNumber = index + 1;
    return {
      key: `${now.year}-${String(monthNumber).padStart(2, "0")}`,
      label: monthLabel(monthNumber),
      revenue: 0,
      shipments: 0,
      orders: 0,
      cod: 0,
      prepaid: 0,
    };
  });
  return { today, month, year };
}

function seriesIndex(range: AnalyticsRange, parts: IstParts, now: IstParts) {
  if (!inRange(parts, now, range)) return -1;
  if (range === "today") return parts.hour;
  if (range === "month") return parts.day - 1;
  return parts.month - 1;
}

function emptySources(): Record<AnalyticsRange, Map<string, AnalyticsSourceShare>> {
  return {
    today: new Map(),
    month: new Map(),
    year: new Map(),
  };
}

function bumpSource(
  maps: Record<AnalyticsRange, Map<string, AnalyticsSourceShare>>,
  range: AnalyticsRange,
  source: string,
  amount: number
) {
  const map = maps[range];
  const current = map.get(source) ?? {
    source,
    label: sourceLabel(source),
    orders: 0,
    revenue: 0,
    share: 0,
  };
  current.orders += 1;
  current.revenue += amount;
  map.set(source, current);
}

function finalizeSources(map: Map<string, AnalyticsSourceShare>): AnalyticsSourceShare[] {
  const rows = [...map.values()];
  const total = rows.reduce((sum, row) => sum + row.orders, 0);
  return rows
    .map((row) => ({
      ...row,
      share: total > 0 ? (row.orders / total) * 100 : 0,
    }))
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
}

export function aggregateAnalytics(
  orders: AnalyticsOrderRow[],
  shipments: AnalyticsShipmentRow[],
  nowInput: Date = new Date(),
  truncated = false
): DashboardAnalytics {
  const now = istParts(nowInput);
  const series = buildSeries(now);
  const periods = {
    today: emptyPeriod(),
    month: emptyPeriod(),
    year: emptyPeriod(),
  };
  const sources = emptySources();
  const ranges: AnalyticsRange[] = ["today", "month", "year"];

  for (const order of orders) {
    if (!isActiveOrder(order)) continue;
    const parts = istParts(order.created_at);
    if (parts.year !== now.year) continue;
    const amount = asAmount(order.total_amount);
    const source = (order.source || "MANUAL").toUpperCase();
    const cod = isCodOrder(order);

    for (const range of ranges) {
      if (!inRange(parts, now, range)) continue;
      periods[range].orders += 1;
      periods[range].revenue += amount;
      if (cod) {
        periods[range].codOrders += 1;
        periods[range].codAmount += amount;
      }
      bumpSource(sources, range, source, amount);
      const index = seriesIndex(range, parts, now);
      const point = series[range][index];
      if (!point) continue;
      point.orders += 1;
      point.revenue += amount;
      if (cod) point.cod += 1;
      else point.prepaid += 1;
    }
  }

  for (const shipment of shipments) {
    if (!isActiveShipment(shipment)) continue;
    const parts = istParts(shipment.created_at);
    if (parts.year !== now.year) continue;
    for (const range of ranges) {
      if (!inRange(parts, now, range)) continue;
      periods[range].shipments += 1;
      const index = seriesIndex(range, parts, now);
      const point = series[range][index];
      if (point) point.shipments += 1;
    }
  }

  const yearSources = finalizeSources(sources.year);

  return {
    timezone: ANALYTICS_TIMEZONE,
    generatedAt: nowInput.toISOString(),
    truncated,
    today: periods.today,
    month: periods.month,
    year: periods.year,
    topSource: yearSources[0] ?? null,
    sources: {
      today: finalizeSources(sources.today),
      month: finalizeSources(sources.month),
      year: yearSources,
    },
    series,
  };
}

async function fetchPaged<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
) {
  const rows: T[] = [];
  let from = 0;
  while (from < ANALYTICS_MAX_ROWS) {
    const to = Math.min(from + ANALYTICS_PAGE_SIZE - 1, ANALYTICS_MAX_ROWS - 1);
    const { data, error } = await query(from, to);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < ANALYTICS_PAGE_SIZE || rows.length >= ANALYTICS_MAX_ROWS) break;
    from += ANALYTICS_PAGE_SIZE;
  }
  return { rows, truncated: rows.length >= ANALYTICS_MAX_ROWS };
}

export async function getAnalytics(supabase: SupabaseClient, ctx: TenantContext, now = new Date()) {
  const since = startOfIstYearIso(now);
  const [orders, shipments] = await Promise.all([
    fetchPaged<AnalyticsOrderRow>((from, to) =>
      supabase
        .from("orders")
        .select("created_at, total_amount, source, payment_status, status")
        .eq("organization_id", ctx.organizationId)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
    fetchPaged<AnalyticsShipmentRow>((from, to) =>
      supabase
        .from("shipments")
        .select("created_at, payment_mode, cod_amount, status")
        .eq("organization_id", ctx.organizationId)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  ]);

  return aggregateAnalytics(orders.rows, shipments.rows, now, orders.truncated || shipments.truncated);
}
