"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Package, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/lib/format";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import type { InventoryAnalytics } from "@/types/api";

function MetricCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const content = (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-brand/30">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function StockDistribution({
  totalProducts,
  lowStock,
  outOfStock,
}: {
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
}) {
  const healthy = Math.max(0, totalProducts - outOfStock - lowStock);
  const total = Math.max(1, healthy + lowStock + outOfStock);
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="font-semibold text-ink">Stock distribution</h3>
      <div className="mt-3 space-y-3">
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-soft">
          <span className="bg-emerald-500" style={{ width: `${(healthy / total) * 100}%` }} />
          <span className="bg-amber-400" style={{ width: `${(lowStock / total) * 100}%` }} />
          <span className="bg-red-500" style={{ width: `${(outOfStock / total) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span>Healthy {formatNumber(healthy)}</span>
          <span>Low {formatNumber(lowStock)}</span>
          <span>Out {formatNumber(outOfStock)}</span>
        </div>
      </div>
    </section>
  );
}

export function InventoryOverview({
  range,
  onRangeChange,
}: {
  range: "today" | "7d" | "30d";
  onRangeChange: (range: "today" | "7d" | "30d") => void;
}) {
  const query = useQuery({
    queryKey: ["inventory-analytics", range],
    queryFn: () => api<InventoryAnalytics>(`/api/v1/inventory/analytics?${toSearchParams({ range })}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const emptySales = (data?.orderCount ?? 0) === 0;

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-semibold text-ink">Something went wrong.</p>
        <p className="mt-1 text-sm text-muted">Please try again.</p>
        <Button className="mt-4" type="button" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Inventory analytics</h2>
          <p className="text-xs text-muted">Live catalog, stock, and order payment totals for this workspace.</p>
        </div>
        <div className="flex rounded-xl border border-border bg-surface-soft p-1">
          {(["today", "7d", "30d"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`h-9 rounded-lg px-3 text-sm font-medium ${
                range === value ? "bg-card text-ink shadow-sm" : "text-muted"
              }`}
              onClick={() => onRangeChange(value)}
            >
              {value === "today" ? "Today" : value === "7d" ? "7 days" : "30 days"}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Total products"
              value={formatNumber(data?.totalProducts ?? 0)}
              href="/dashboard/inventory?tab=products"
            />
            <MetricCard
              label="Active products"
              value={formatNumber(data?.activeProducts ?? 0)}
              href="/dashboard/inventory?tab=products&active=true"
            />
            <MetricCard label="Total stock" value={formatNumber(data?.totalStock ?? 0)} />
            <MetricCard
              label="Low stock"
              value={formatNumber(data?.lowStock ?? 0)}
              href="/dashboard/inventory?tab=products&stock=lowStock"
            />
            <MetricCard
              label="Out of stock"
              value={formatNumber(data?.outOfStock ?? 0)}
              href="/dashboard/inventory?tab=products&stock=outOfStock"
            />
            <MetricCard
              label="Orders"
              value={emptySales ? "No data yet" : formatNumber(data?.orderCount ?? 0)}
            />
            <MetricCard
              label="Units sold"
              value={emptySales ? "No data yet" : formatNumber(data?.totalUnitsSold ?? 0)}
            />
            <MetricCard
              label="Revenue"
              value={emptySales ? "No data yet" : formatCurrency(data?.totalSales ?? 0)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Total product value" value={formatCurrency(data?.totalProductValue ?? 0)} />
            <MetricCard
              label="Amount received"
              value={emptySales ? "No data yet" : formatCurrency(data?.amountReceived ?? 0)}
            />
            <MetricCard
              label="Pending amount"
              value={emptySales ? "No data yet" : formatCurrency(data?.pendingAmount ?? 0)}
            />
            <MetricCard
              label="COD outstanding"
              value={emptySales ? "No data yet" : formatCurrency(data?.codOutstanding ?? 0)}
            />
          </div>
        </>
      )}

      {data?.totalProducts ? (
        <StockDistribution
          totalProducts={data.totalProducts}
          lowStock={data.lowStock}
          outOfStock={data.outOfStock}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="size-4 text-muted" />
            <h3 className="font-semibold text-ink">Top products</h3>
          </div>
          {!data?.topProducts.length ? (
            <p className="py-8 text-center text-sm text-muted">
              Sales analytics will appear here once orders start coming in.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.topProducts.map((product) => (
                <li key={product.productId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{product.name}</p>
                    <p className="text-xs text-muted">
                      {product.sku} · {formatNumber(product.unitsSold)} sold · {formatNumber(product.onHand)} in stock
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(product.revenue)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" />
            <h3 className="font-semibold text-ink">Low stock products</h3>
          </div>
          {!data?.lowStockProducts.length ? (
            <p className="py-8 text-center text-sm text-muted">No inventory alerts right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.lowStockProducts.map((product) => (
                <li key={product.productId} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{product.name}</p>
                    <p className="text-xs text-muted">
                      Threshold {formatNumber(product.lowStockThreshold)} · SKU {product.sku}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        product.onHand <= 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {product.onHand <= 0 ? "Out of stock" : "Low stock"} · {product.onHand}
                    </span>
                    <Link
                      href={`/dashboard/inventory?tab=products&q=${encodeURIComponent(product.sku)}`}
                      className="inline-flex h-9 items-center rounded-[var(--radius-btn)] border border-border bg-card px-3.5 text-xs font-semibold"
                    >
                      Adjust
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!data?.totalProducts ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Package className="mx-auto size-8 text-muted" />
          <p className="mt-3 font-semibold text-ink">Add your first product</p>
          <p className="mt-1 text-sm text-muted">Catalog, stock, and storefront analytics start here.</p>
          <Link href="/dashboard/inventory?tab=products" className="mt-4 inline-flex h-11 items-center rounded-[var(--radius-btn)] bg-brand px-5 text-sm font-semibold text-white">
            Go to products
          </Link>
        </div>
      ) : null}
    </div>
  );
}
