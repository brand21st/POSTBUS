"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { useReadOnly } from "@/components/ai-accountant/shell";
import { ExportButtons, Kpi, Money, NativeSelect, Notes, TableShell, presetPeriods, td, th } from "@/components/ai-accountant/shared";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate, formatPaise, titleCase } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";

type ColumnMap = Partial<Record<"article" | "cod" | "commission" | "net" | "date", number>>;
type Preview = {
  format: string;
  headers: string[];
  columnMap: ColumnMap | null;
  rows: Array<{ articleBarcode: string; deliveredOn?: string | null; codAmountPaise: number; commissionPaise: number; netAmountPaise: number }>;
  rowCount: number;
  warnings: string[];
};
type Recon = {
  id: string;
  status: string;
  reason: string | null;
  expected_cod: number | null;
  reported_cod: number | null;
  variance: number | null;
  resolution_note: string | null;
  cod_report_rows: { article_barcode: string; delivered_on: string | null; net_amount: number } | null;
};
type CodList = {
  reports: Array<{ id: string; file_name: string; status: string; format: string | null; row_count: number; matched_count: number; created_at: string }>;
  reconciliations: Recon[];
  summary: Record<string, number>;
};

const COLUMNS: Array<{ key: keyof ColumnMap; label: string }> = [
  { key: "article", label: "Article number" },
  { key: "cod", label: "COD amount" },
  { key: "commission", label: "Commission" },
  { key: "net", label: "Net remitted" },
  { key: "date", label: "Delivery date" },
];

const REASONS: Record<string, string> = {
  missing_shipment: "No PostBus shipment with this article",
  cancelled_shipment: "Shipment was cancelled",
  duplicate_remittance: "Already remitted in an earlier report",
  rto_shipment: "Shipment is marked RTO",
  prepaid_shipment: "Shipment was prepaid",
  short_remittance: "Less than the COD amount",
  excess_remittance: "More than the COD amount",
};

function ResolveDialog({ row, onClose }: { row: Recon | null; onClose: () => void }) {
  const client = useQueryClient();
  const [status, setStatus] = useState("RECONCILED");
  const [note, setNote] = useState("");
  const resolve = useMutation({
    mutationFn: () => api(`/api/v1/ai-accountant/cod/reconciliations/${row!.id}/resolve`, { method: "POST", body: JSON.stringify({ status, note }) }),
    onSuccess: () => {
      toast.success("Row resolved.");
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
      setNote("");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve {row?.cod_report_rows?.article_barcode}</DialogTitle>
          <DialogDescription>{row?.reason ? REASONS[row.reason] ?? titleCase(row.reason) : null}</DialogDescription>
        </DialogHeader>
        <NativeSelect aria-label="Decision" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="RECONCILED">Accept the remitted amount (posts to ledger)</option>
          <option value="WRITTEN_OFF">Write off — will not be collected</option>
          <option value="UNMATCHED">Leave unmatched</option>
        </NativeSelect>
        <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Reason, e.g. India Post deducted damage claim" />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={note.trim().length < 3 || resolve.isPending} onClick={() => resolve.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CodPage() {
  const readOnly = useReadOnly();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [filter, setFilter] = useState("");
  const [resolving, setResolving] = useState<Recon | null>(null);
  const list = useQuery({
    queryKey: ["ai-accountant", "cod", filter],
    queryFn: () => api<CodList>(`/api/v1/ai-accountant/cod${filter ? `?status=${filter}` : ""}`),
  });
  const form = (f: File, columnMap?: ColumnMap) => {
    const body = new FormData();
    body.append("file", f);
    if (columnMap && Object.keys(columnMap).length) body.append("columnMap", JSON.stringify(columnMap));
    return body;
  };
  const previewMutation = useMutation({
    mutationFn: (input: { file: File; map?: ColumnMap }) => api<Preview>("/api/v1/ai-accountant/cod/preview", { method: "POST", body: form(input.file, input.map) }),
    onSuccess: (data) => {
      setPreview(data);
      if (data.columnMap) setMap(data.columnMap);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const importMutation = useMutation({
    mutationFn: () => api<{ duplicate: boolean; rows?: number; matched?: number }>("/api/v1/ai-accountant/cod", { method: "POST", body: form(file!, preview?.headers.length ? map : undefined) }),
    onSuccess: (data) => {
      toast.success(data.duplicate ? "This report was already imported." : `Imported ${data.rows} rows, ${data.matched} matched automatically.`);
      setFile(null);
      setPreview(null);
      client.invalidateQueries({ queryKey: ["ai-accountant"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const summary = list.data?.summary ?? {};
  const fy = presetPeriods().this_fy;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Reconciled" value={summary.RECONCILED ?? 0} tone="good" />
        <Kpi label="Needs review" value={summary.NEEDS_REVIEW ?? 0} tone={summary.NEEDS_REVIEW ? "warn" : undefined} />
        <Kpi label="Unmatched" value={summary.UNMATCHED ?? 0} tone={summary.UNMATCHED ? "bad" : undefined} />
        <Kpi label="Written off" value={summary.WRITTEN_OFF ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import India Post COD remittance report</CardTitle>
          <CardDescription>Excel, CSV or PDF from India Post. Rows match your shipments by article number; exact amounts post to the ledger automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              className="max-w-sm"
              accept=".xlsx,.csv,.pdf,.txt,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={readOnly}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(null);
                setMap({});
                if (f) previewMutation.mutate({ file: f });
              }}
            />
            {preview ? (
              <Button size="sm" disabled={readOnly || importMutation.isPending || !preview.rowCount} onClick={() => importMutation.mutate()}>
                <Upload className="size-4" /> Import {preview.rowCount} rows
              </Button>
            ) : null}
          </div>
          {preview ? (
            <div className="space-y-3">
              <Notes notes={preview.warnings} />
              {preview.headers.length ? (
                <div className="flex flex-wrap gap-2">
                  {COLUMNS.map((col) => (
                    <label key={col.key} className="space-y-1 text-xs text-muted">
                      <span className="block">{col.label}</span>
                      <NativeSelect
                        className="h-9"
                        value={map[col.key] ?? ""}
                        onChange={(e) => {
                          const next = { ...map };
                          if (e.target.value === "") delete next[col.key];
                          else next[col.key] = Number(e.target.value);
                          setMap(next);
                          if (file) previewMutation.mutate({ file, map: next });
                        }}
                      >
                        <option value="">Not in file</option>
                        {preview.headers.map((header, index) => (
                          <option key={index} value={index}>
                            {header || `Column ${index + 1}`}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                  ))}
                </div>
              ) : null}
              <TableShell>
                <thead>
                  <tr>
                    <th className={th}>Article</th>
                    <th className={th}>Delivered</th>
                    <th className={cn(th, "text-right")}>COD</th>
                    <th className={cn(th, "text-right")}>Commission</th>
                    <th className={cn(th, "text-right")}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.articleBarcode}>
                      <td className={cn(td, "font-mono text-xs")}>{row.articleBarcode}</td>
                      <td className={td}>{row.deliveredOn ?? "—"}</td>
                      <td className={cn(td, "text-right")}>{formatPaise(row.codAmountPaise)}</td>
                      <td className={cn(td, "text-right")}>{formatPaise(row.commissionPaise)}</td>
                      <td className={cn(td, "text-right")}>{formatPaise(row.netAmountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              {preview.rowCount > preview.rows.length ? <p className="text-xs text-muted">Showing first {preview.rows.length} of {preview.rowCount} rows.</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Reconciliation</CardTitle>
            <CardDescription>COD collected is not extra sales; it settles what customers owed at delivery.</CardDescription>
          </div>
          <div className="flex gap-2">
            <NativeSelect aria-label="Status filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All rows</option>
              <option value="NEEDS_REVIEW">Needs review</option>
              <option value="UNMATCHED">Unmatched</option>
              <option value="RECONCILED">Reconciled</option>
              <option value="WRITTEN_OFF">Written off</option>
            </NativeSelect>
            <ExportButtons kind="COD" period={fy} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <TableShell>
            <thead>
              <tr>
                <th className={th}>Article</th>
                <th className={th}>Status</th>
                <th className={cn(th, "text-right")}>Expected</th>
                <th className={cn(th, "text-right")}>Reported</th>
                <th className={cn(th, "text-right")}>Difference</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {(list.data?.reconciliations ?? []).map((row) => (
                <tr key={row.id}>
                  <td className={cn(td, "font-mono text-xs")}>
                    {row.cod_report_rows?.article_barcode}
                    {row.cod_report_rows?.delivered_on ? <span className="block font-sans text-muted">{row.cod_report_rows.delivered_on}</span> : null}
                  </td>
                  <td className={td}>
                    <StatusBadge value={row.status} />
                    <span className="mt-1 block text-xs text-muted">{row.resolution_note ?? (row.reason ? REASONS[row.reason] ?? titleCase(row.reason) : "")}</span>
                  </td>
                  <td className={cn(td, "text-right")}>{row.expected_cod !== null ? <Money paise={Math.round(Number(row.expected_cod) * 100)} /> : "—"}</td>
                  <td className={cn(td, "text-right")}>{row.reported_cod !== null ? <Money paise={Math.round(Number(row.reported_cod) * 100)} /> : "—"}</td>
                  <td className={cn(td, "text-right")}>{row.variance ? <Money paise={Math.round(Number(row.variance) * 100)} /> : "—"}</td>
                  <td className={cn(td, "text-right")}>
                    {row.status !== "RECONCILED" ? (
                      <Button size="xs" variant="secondary" disabled={readOnly} onClick={() => setResolving(row)}>
                        Resolve
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {list.data && !list.data.reconciliations.length ? (
                <tr>
                  <td colSpan={6} className={cn(td, "py-10 text-center text-muted")}>
                    No rows yet. Import a COD report above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableShell>
          {list.data?.reports.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted">Recent reports</p>
              {list.data.reports.slice(0, 5).map((report) => (
                <p key={report.id} className="text-xs text-muted">
                  {formatDate(report.created_at)} · {report.file_name} · {report.format ?? "?"} · {report.matched_count}/{report.row_count} matched
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <ResolveDialog row={resolving} onClose={() => setResolving(null)} />
    </div>
  );
}
