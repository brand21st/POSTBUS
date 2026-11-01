"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/hooks/use-api";

type SheetCell = string | number | boolean | null;
type SheetPart = { part: number; from: number; to: number; count: number; filename: string };
type ArticleDetailsSheet = {
  batchId: string;
  headers: string[];
  rows: Array<{ id: string; excelRowNumber: number; status: string; cells: SheetCell[] }>;
  total: number;
  excluded: number;
  missingBarcodes: number;
  limit: number;
  parts: SheetPart[];
};

const VISIBLE_ROWS = 300;

function display(value: SheetCell) {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  return value == null ? "" : String(value);
}

async function downloadPart(batchId: string, part: SheetPart) {
  const response = await fetch(`/api/v1/bookings/excel-imports/${batchId}/india-post-export?part=${part.part}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    toast.error(body?.message || "Could not export the India Post sheet.");
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = part.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** India Post ArticleDetails output for a validated import: preview in-app and export per file. */
export function IndiaPostSheetView({ batchId, refreshKey }: { batchId: string; refreshKey?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const sheet = useQuery({
    queryKey: ["bulk-excel-india-post-sheet", batchId, refreshKey],
    queryFn: () => api<ArticleDetailsSheet>(`/api/v1/bookings/excel-imports/${batchId}/india-post-sheet`),
  });

  const filtered = useMemo(() => {
    const rows = sheet.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.cells.some((value) => display(value).toLowerCase().includes(q)));
  }, [sheet.data, query]);

  if (sheet.isLoading) return <p className="text-sm text-muted">Preparing the India Post sheet…</p>;
  if (sheet.error) return <p className="text-sm text-muted">{(sheet.error as Error).message}</p>;
  const data = sheet.data;
  if (!data) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">India Post Excel (ArticleDetails)</h2>
          <p className="text-xs text-muted">
            {data.total} valid row{data.total === 1 ? "" : "s"} in the India Post bulk upload format
            {data.excluded ? `, ${data.excluded} invalid row${data.excluded === 1 ? "" : "s"} left out` : ""}. Up to{" "}
            {data.limit} rows per file.
          </p>
          {data.missingBarcodes ? (
            <p className="mt-1 text-xs text-amber-700">
              {data.missingBarcodes} row{data.missingBarcodes === 1 ? " has" : "s have"} no barcode yet. Barcodes are
              assigned from your range when you book.
            </p>
          ) : null}
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={!data.total} onClick={() => setOpen(!open)}>
          {open ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {open ? "Hide sheet" : "View sheet"}
        </Button>
      </div>

      {data.parts.length ? (
        <ul className="flex flex-wrap gap-2">
          {data.parts.map((part) => (
            <li key={part.part}>
              <Button type="button" size="sm" onClick={() => void downloadPart(data.batchId, part)}>
                <Download className="size-4" />
                {data.parts.length > 1 ? `File ${part.part} (rows ${part.from}–${part.to})` : `Export Excel (${part.count} rows)`}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">There are no valid rows to export.</p>
      )}

      {open ? (
        <div className="space-y-2">
          <Input placeholder="Search the sheet" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-border">
            <table className="min-w-max text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left">
                  {data.headers.map((header) => (
                    <th key={header} className="whitespace-nowrap p-2 font-semibold">
                      {header.trim()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, VISIBLE_ROWS).map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    {row.cells.map((value, index) => (
                      <td key={data.headers[index]} className="max-w-64 truncate whitespace-nowrap p-2" title={display(value)}>
                        {display(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > VISIBLE_ROWS ? (
            <p className="text-xs text-muted">
              Showing the first {VISIBLE_ROWS} of {filtered.length} rows. The exported file has every row.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
