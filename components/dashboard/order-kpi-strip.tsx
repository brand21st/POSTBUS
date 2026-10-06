"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  MapPin,
  Package,
  ShoppingBag,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { formatNumber } from "@/lib/format";
import { kpiChange, kpiValue } from "@/lib/dashboard/records";
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/types/api";

export const ORDER_KPI_FILTERS: Array<{
  id: string;
  label: string;
  kpi: keyof DashboardKpis;
  fallback: string[];
  status: string;
  icon: LucideIcon;
  className: string;
  iconClass: string;
}> = [
  {
    id: "all",
    label: "All Orders",
    kpi: "orders",
    fallback: ["orders"],
    status: "all",
    icon: ShoppingBag,
    className: "border-rose-100 bg-rose-50/80",
    iconClass: "bg-rose-100 text-brand",
  },
  {
    id: "ready",
    label: "Ready to Ship",
    kpi: "readyToShip",
    fallback: ["ready", "readyToShip"],
    status: "READY",
    icon: Package,
    className: "border-emerald-100 bg-emerald-50/80",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "booked",
    label: "Booked",
    kpi: "booked",
    fallback: ["booked"],
    status: "BOOKED",
    icon: Truck,
    className: "border-sky-100 bg-sky-50/80",
    iconClass: "bg-sky-100 text-sky-700",
  },
  {
    id: "transit",
    label: "In Transit",
    kpi: "inTransit",
    fallback: ["inTransit", "in_transit"],
    status: "IN_TRANSIT",
    icon: MapPin,
    className: "border-amber-100 bg-amber-50/70",
    iconClass: "bg-amber-100 text-amber-800",
  },
  {
    id: "delivered",
    label: "Delivered",
    kpi: "delivered",
    fallback: ["delivered"],
    status: "DELIVERED",
    icon: CheckCircle2,
    className: "border-emerald-100 bg-emerald-50/50",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "failed",
    label: "Failed / NDR",
    kpi: "failed",
    fallback: ["failed"],
    status: "FAILED",
    icon: TriangleAlert,
    className: "border-red-100 bg-red-50/80",
    iconClass: "bg-red-100 text-red-700",
  },
];

export function OrderKpiStrip({
  data,
  loading,
  error,
  activeStatus,
  onSelect,
}: {
  data?: DashboardKpis;
  loading?: boolean;
  error?: boolean;
  activeStatus: string;
  onSelect: (status: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6 [&::-webkit-scrollbar]:hidden">
      {ORDER_KPI_FILTERS.map((card) => {
        const value = kpiValue(data, card.kpi, [...card.fallback]);
        const change = kpiChange(data, card.kpi);
        const active = activeStatus === card.status;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(card.status)}
            className={cn(
              "min-w-[8.75rem] shrink-0 rounded-xl border px-2.5 py-2 text-left transition-colors hover:shadow-sm sm:min-w-0",
              card.className,
              active && "ring-2 ring-brand/30"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium text-muted">{card.label}</p>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  card.iconClass
                )}
              >
                <card.icon className="size-3.5" />
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-ink">
                {loading ? "…" : error ? "—" : formatNumber(value)}
              </p>
              {change === null ? null : (
                <p
                  className={cn(
                    "hidden items-center gap-0.5 text-[10px] font-medium sm:flex",
                    change >= 0 ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {change >= 0 ? (
                    <ArrowUpRight className="size-3" />
                  ) : (
                    <ArrowDownRight className="size-3" />
                  )}
                  {change >= 0 ? "+" : ""}
                  {Math.round(change)}%
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
