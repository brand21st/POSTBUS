"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExportButtons, Money, Notes, PeriodPicker, TableShell, qs, td, th, usePeriod, type ExportKind } from "@/components/ai-accountant/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type Line = { code: string; name: string; amountPaise: number };
type Pnl = {
  revenue: Line[];
  directCosts: Line[];
  operating: Line[];
  revenuePaise: number;
  directCostPaise: number;
  grossProfitPaise: number;
  operatingPaise: number;
  netProfitPaise: number;
  completeness: string;
  notes: string[];
};
type Cashflow = { netProfitPaise: number; adjustments: Line[]; operatingPaise: number; investingPaise: number; financingPaise: number; netChangePaise: number; reconciles: boolean };
type Balance = { assets: Line[]; liabilities: Line[]; equity: Line[]; assetsPaise: number; liabilitiesPaise: number; equityPaise: number; balanced: boolean };

const TABS = [
  { key: "pnl", label: "Profit & loss", exportKind: "PNL" },
  { key: "cashflow", label: "Cash flow", exportKind: "CASHFLOW" },
  { key: "balance", label: "Balance sheet", exportKind: "BALANCE" },
] as const;

function Section({ title, lines, totalPaise }: { title: string; lines: Line[]; totalPaise?: number }) {
  return (
    <>
      <tr>
        <td colSpan={2} className={cn(td, "bg-surface-soft/60 font-medium text-ink")}>
          {title}
        </td>
      </tr>
      {lines.length ? (
        lines.map((line) => (
          <tr key={`${title}-${line.code}`}>
            <td className={td}>
              <span className="mr-2 text-xs text-muted">{line.code}</span>
              {line.name}
            </td>
            <td className={cn(td, "text-right")}>
              <Money paise={line.amountPaise} />
            </td>
          </tr>
        ))
      ) : (
        <tr>
          <td colSpan={2} className={cn(td, "text-xs text-muted")}>
            Nothing posted
          </td>
        </tr>
      )}
      {totalPaise !== undefined ? <TotalRow label={`Total ${title.toLowerCase()}`} paise={totalPaise} /> : null}
    </>
  );
}

function TotalRow({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <tr>
      <td className={cn(td, strong ? "font-semibold text-ink" : "font-medium")}>{label}</td>
      <td className={cn(td, "text-right", strong ? "font-semibold" : "font-medium")}>
        <Money paise={paise} />
      </td>
    </tr>
  );
}

function Statement({ children }: { children: React.ReactNode }) {
  return (
    <TableShell>
      <thead>
        <tr>
          <th className={th}>Account</th>
          <th className={cn(th, "text-right")}>Amount</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </TableShell>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pnl");
  const { period, setPeriod } = usePeriod("this_fy");
  const endpoint = tab === "balance" ? `reports/balance${qs({ asOf: period.to })}` : `reports/${tab}${qs(period)}`;
  const report = useQuery({
    queryKey: ["ai-accountant", "report", tab, period.from, period.to],
    queryFn: () => api<Pnl & Cashflow & Balance>(`/api/v1/ai-accountant/${endpoint}`),
  });
  const active = TABS.find((t) => t.key === tab)!;
  const data = report.data;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-xl border border-border p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn("rounded-lg px-3 py-1.5 text-sm", tab === t.key ? "bg-surface-soft font-medium text-ink" : "text-muted hover:text-ink")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <ExportButtons kind={active.exportKind as ExportKind} period={period} />
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
        <CardTitle className="pt-1">{active.label}</CardTitle>
        <CardDescription>
          {tab === "balance" ? `As at ${period.to}, from all posted entries.` : `${period.from} to ${period.to}, from posted ledger entries.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {report.isLoading || !data ? (
          report.error ? <p className="text-sm text-rose-600">{report.error.message}</p> : <Skeleton className="h-64 w-full" />
        ) : tab === "pnl" ? (
          <>
            <Notes notes={data.notes} />
            <Statement>
              <Section title="Revenue" lines={data.revenue} totalPaise={data.revenuePaise} />
              <Section title="Direct costs" lines={data.directCosts} totalPaise={data.directCostPaise} />
              <TotalRow label="Gross profit" paise={data.grossProfitPaise} strong />
              <Section title="Operating expenses" lines={data.operating} totalPaise={data.operatingPaise} />
              <TotalRow label={data.completeness === "INCOMPLETE" ? "Net profit (not verified)" : "Net profit"} paise={data.netProfitPaise} strong />
            </Statement>
          </>
        ) : tab === "cashflow" ? (
          <>
            {!data.reconciles ? <Notes notes={["Cash flow does not reconcile to cash and bank movement. Check manual entries."]} /> : null}
            <Statement>
              <TotalRow label="Net profit" paise={data.netProfitPaise} />
              <Section title="Working capital changes" lines={data.adjustments} />
              <TotalRow label="Cash from operations" paise={data.operatingPaise} strong />
              <TotalRow label="Cash from investing" paise={data.investingPaise} />
              <TotalRow label="Cash from financing (owner)" paise={data.financingPaise} />
              <TotalRow label="Net change in cash and bank" paise={data.netChangePaise} strong />
            </Statement>
          </>
        ) : (
          <>
            {!data.balanced ? <Notes notes={["Assets do not equal liabilities plus equity. Run a ledger sync or check manual entries."]} /> : null}
            <Statement>
              <Section title="Assets" lines={data.assets} totalPaise={data.assetsPaise} />
              <Section title="Liabilities" lines={data.liabilities} totalPaise={data.liabilitiesPaise} />
              <Section title="Equity" lines={data.equity} totalPaise={data.equityPaise} />
            </Statement>
          </>
        )}
      </CardContent>
    </Card>
  );
}
