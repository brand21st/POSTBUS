"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { NativeSelect, PeriodPicker, TableShell, td, th, useExport, usePeriod, type ExportKind } from "@/components/ai-accountant/shared";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

const KINDS: Array<{ kind: ExportKind; label: string; formats: Array<"CSV" | "XLSX" | "XML"> }> = [
  { kind: "PNL", label: "Profit and loss", formats: ["XLSX", "CSV"] },
  { kind: "BALANCE", label: "Balance sheet (as at end date)", formats: ["XLSX", "CSV"] },
  { kind: "CASHFLOW", label: "Cash flow", formats: ["XLSX", "CSV"] },
  { kind: "TRIAL_BALANCE", label: "Trial balance", formats: ["XLSX", "CSV"] },
  { kind: "JOURNAL", label: "Journal (day book)", formats: ["XLSX", "CSV"] },
  { kind: "TALLY", label: "Tally Prime import (ledgers + vouchers)", formats: ["XML"] },
  { kind: "GSTR1", label: "GSTR-1 draft (start month)", formats: ["XLSX", "CSV"] },
  { kind: "GSTR3B", label: "GSTR-3B draft (start month)", formats: ["XLSX", "CSV"] },
  { kind: "EXPENSES", label: "Expenses", formats: ["XLSX", "CSV"] },
  { kind: "COD", label: "COD reconciliation", formats: ["XLSX", "CSV"] },
];

type ExportRow = { id: string; kind: string; format: string; period_from: string; period_to: string; status: string; error_message: string | null; created_at: string };

export default function ExportsPage() {
  const { period, setPeriod } = usePeriod("last_month");
  const [kind, setKind] = useState<ExportKind>("PNL");
  const choice = KINDS.find((k) => k.kind === kind)!;
  const [format, setFormat] = useState<"CSV" | "XLSX" | "XML">("XLSX");
  const run = useExport();
  const list = useQuery({ queryKey: ["ai-accountant", "exports", run.data?.id], queryFn: () => api<{ exports: ExportRow[] }>("/api/v1/ai-accountant/exports") });
  const effectiveFormat = choice.formats.includes(format) ? format : choice.formats[0]!;
  const download = async (id: string) => {
    try {
      const { url } = await api<{ url: string }>(`/api/v1/ai-accountant/exports/${id}/download`);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Download for your CA or Tally</CardTitle>
          <CardDescription>Files are stored privately for your workspace; links expire after five minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Report" value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
              {KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Format" value={effectiveFormat} onChange={(e) => setFormat(e.target.value as "CSV" | "XLSX" | "XML")}>
              {choice.formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </NativeSelect>
          </div>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Button disabled={run.isPending} onClick={() => run.mutate({ kind, format: effectiveFormat, ...period })}>
            <Download className="size-4" /> Generate
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent exports</CardTitle>
        </CardHeader>
        <CardContent>
          <TableShell>
            <thead>
              <tr>
                <th className={th}>Created</th>
                <th className={th}>Report</th>
                <th className={th}>Period</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {(list.data?.exports ?? []).map((row) => (
                <tr key={row.id}>
                  <td className={td}>{formatDate(row.created_at, true)}</td>
                  <td className={td}>
                    {KINDS.find((k) => k.kind === row.kind)?.label ?? row.kind} · {row.format}
                  </td>
                  <td className={cn(td, "text-xs text-muted")}>
                    {row.period_from} to {row.period_to}
                  </td>
                  <td className={td}>
                    <StatusBadge value={row.status} />
                    {row.error_message ? <span className="block text-xs text-rose-600">{row.error_message}</span> : null}
                  </td>
                  <td className={cn(td, "text-right")}>
                    {row.status === "READY" ? (
                      <Button size="xs" variant="secondary" onClick={() => download(row.id)}>
                        Download
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {list.data && !list.data.exports.length ? (
                <tr>
                  <td colSpan={5} className={cn(td, "py-8 text-center text-muted")}>
                    No exports yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableShell>
        </CardContent>
      </Card>
    </div>
  );
}
