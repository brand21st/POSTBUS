"use client";

import { useMemo, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatPaise } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

export type Period = { from: string; to: string };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Today's date in IST as YYYY-MM-DD (client side). */
export function istToday() {
  const d = new Date(Date.now() + 330 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function monthRange(y: number, m: number): Period {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

export function presetPeriods(fiscalStartMonth = 4) {
  const [y, m] = istToday().split("-").map(Number) as [number, number];
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const fyStart = m >= fiscalStartMonth ? y : y - 1;
  const fy = (start: number): Period => {
    const end = monthRange(fiscalStartMonth === 1 ? start : start + 1, fiscalStartMonth === 1 ? 12 : fiscalStartMonth - 1);
    return { from: `${start}-${pad(fiscalStartMonth)}-01`, to: end.to };
  };
  return {
    this_month: { label: "This month", ...monthRange(y, m) },
    last_month: { label: "Last month", ...monthRange(prev.y, prev.m) },
    this_fy: { label: "This financial year", ...fy(fyStart) },
    last_fy: { label: "Last financial year", ...fy(fyStart - 1) },
  };
}

export function usePeriod(initial: keyof ReturnType<typeof presetPeriods> = "this_month") {
  const presets = useMemo(() => presetPeriods(), []);
  const [period, setPeriod] = useState<Period>({ from: presets[initial].from, to: presets[initial].to });
  return { period, setPeriod, presets };
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 rounded-[var(--radius-input)] border border-border bg-card px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  const presets = useMemo(() => presetPeriods(), []);
  const match = Object.entries(presets).find(([, p]) => p.from === value.from && p.to === value.to)?.[0] ?? "custom";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label="Period"
        value={match}
        onChange={(event) => {
          const preset = presets[event.target.value as keyof typeof presets];
          if (preset) onChange({ from: preset.from, to: preset.to });
        }}
      >
        {Object.entries(presets).map(([key, p]) => (
          <option key={key} value={key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </NativeSelect>
      <Input type="date" aria-label="From" className="h-10 w-auto" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      <span className="text-xs text-muted">to</span>
      <Input type="date" aria-label="To" className="h-10 w-auto" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
    </div>
  );
}

export function qs(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium text-muted">{label}</p>
        <p
          className={cn(
            "text-xl font-semibold tabular-nums text-ink",
            tone === "good" && "text-emerald-600",
            tone === "bad" && "text-rose-600",
            tone === "warn" && "text-amber-600"
          )}
        >
          {value}
        </p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Money({ paise, className }: { paise: number | null | undefined; className?: string }) {
  const negative = typeof paise === "number" && paise < 0;
  return <span className={cn("tabular-nums", negative && "text-rose-600", className)}>{formatPaise(paise ?? 0)}</span>;
}

export function rupeesToPaiseInput(value: string): number | null {
  const match = value.replace(/,/g, "").trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function Notes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

export type ExportKind = "JOURNAL" | "TRIAL_BALANCE" | "PNL" | "CASHFLOW" | "BALANCE" | "GSTR1" | "GSTR3B" | "COD" | "EXPENSES" | "TALLY";

/** Generates an export and opens the signed download link. */
export function useExport() {
  return useMutation({
    mutationFn: (input: { kind: ExportKind; format: "CSV" | "XLSX" | "XML"; from: string; to: string }) =>
      api<{ id: string; url: string }>("/api/v1/ai-accountant/exports", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (data) => {
      window.open(data.url, "_blank", "noopener");
      toast.success("Export ready.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function ExportButtons({ kind, period, formats = ["XLSX", "CSV"] }: { kind: ExportKind; period: Period; formats?: Array<"CSV" | "XLSX" | "XML"> }) {
  const run = useExport();
  return (
    <div className="flex gap-1.5">
      {formats.map((format) => (
        <Button key={format} size="xs" variant="secondary" disabled={run.isPending} onClick={() => run.mutate({ kind, format, ...period })}>
          <Download className="size-3.5" />
          {format}
        </Button>
      ))}
    </div>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[560px] text-sm">{children}</table>
    </div>
  );
}

export const th = "bg-surface-soft px-3 py-2 text-left text-xs font-medium text-muted";
export const td = "border-t border-border px-3 py-2 align-top";

export const CATEGORY_LABELS: Record<string, string> = {
  inventory: "Inventory / stock",
  packaging: "Packaging",
  marketing: "Marketing and ads",
  rent: "Rent",
  salaries: "Salaries and wages",
  utilities: "Utilities and internet",
  software: "Software",
  professional_fees: "Professional fees",
  bank_charges: "Bank and gateway charges",
  travel: "Travel",
  shipping_expense: "Shipping (other carriers)",
  other_expense: "Other",
};

export const PAYMENT_LABELS: Record<string, string> = {
  bank: "Bank",
  cash: "Cash",
  accounts_payable: "Unpaid (payable)",
  owner_equity: "Paid by owner",
};

/** Current GST 2.0 slabs plus legacy 12% and 28% for older invoices. */
export const GST_RATES = [0, 300, 500, 1200, 1800, 2800, 4000];
