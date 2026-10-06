import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { z } from "zod";
import type { inventoryAnalyticsQuery } from "@/modules/products/schema";
import type { InventoryAnalytics } from "@/types/api";

type Query = z.infer<typeof inventoryAnalyticsQuery>;

function startOfTodayIst() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day, -5, -30, 0, 0));
}

function windowFor(query: Query) {
  const now = new Date();
  if (query.range === "custom") {
    if (!query.from || !query.to) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a start and end date.");
    }
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a valid date range.");
    }
    return { from, to, range: query.range };
  }
  if (query.range === "today") {
    return { from: startOfTodayIst(), to: now, range: query.range };
  }
  const days = query.range === "7d" ? 7 : 30;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), to: now, range: query.range };
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export async function getInventoryAnalytics(
  supabase: SupabaseClient,
  ctx: TenantContext,
  query: Query
): Promise<InventoryAnalytics> {
  const { from, to, range } = windowFor(query);
  const [{ data: summary, error: summaryError }, { data: top, error: topError }, { data: low, error: lowError }] =
    await Promise.all([
      supabase.rpc("inventory_analytics_window", {
        p_organization_id: ctx.organizationId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      }),
      supabase.rpc("inventory_top_products", {
        p_organization_id: ctx.organizationId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_limit: 8,
      }),
      supabase.rpc("inventory_low_stock_products", {
        p_organization_id: ctx.organizationId,
        p_limit: 8,
      }),
    ]);
  if (summaryError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, summaryError.message);
  if (topError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, topError.message);
  if (lowError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, lowError.message);
  const row = Array.isArray(summary) ? summary[0] : summary;
  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    totalProducts: Number(row?.total_products ?? 0),
    activeProducts: Number(row?.active_products ?? 0),
    totalStock: Number(row?.total_stock ?? 0),
    lowStock: Number(row?.low_stock ?? 0),
    outOfStock: Number(row?.out_of_stock ?? 0),
    totalProductValue: money(row?.total_product_value),
    orderCount: Number(row?.order_count ?? 0),
    totalUnitsSold: Number(row?.total_units_sold ?? 0),
    totalSales: money(row?.total_sales),
    amountReceived: money(row?.amount_received),
    pendingAmount: money(row?.pending_amount),
    codOutstanding: money(row?.cod_outstanding),
    topProducts: ((top ?? []) as Array<Record<string, unknown>>).map((item) => ({
      productId: String(item.product_id),
      name: String(item.name ?? "Product"),
      sku: String(item.sku ?? ""),
      orderCount: Number(item.order_count ?? 0),
      unitsSold: Number(item.units_sold ?? 0),
      revenue: money(item.revenue),
      onHand: Number(item.on_hand ?? 0),
    })),
    lowStockProducts: ((low ?? []) as Array<Record<string, unknown>>).map((item) => ({
      productId: String(item.product_id),
      name: String(item.name ?? "Product"),
      sku: String(item.sku ?? ""),
      onHand: Number(item.on_hand ?? 0),
      lowStockThreshold: Number(item.low_stock_threshold ?? 5),
    })),
  };
}
