"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { asPaginated } from "@/lib/dashboard/records";
import { ApiError, api } from "@/lib/hooks/use-api";
import { usePrintStation } from "@/lib/hooks/use-print-station";
import { ptFromMm } from "@/modules/labels/layout/units";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";
import { calculateMultiUpLayout, type MultiUpRotation } from "@/modules/labels/multi-up/layout";
import { PAGE_PRESETS, isPaperSizeId, type PaperSizeId } from "@/modules/labels/page-presets";
import type { LabelTemplate, NamedLabelTemplate } from "@/modules/labels/template-schema";
import type { OrderRecord, Paginated } from "@/types/api";

type TemplateResponse = { template: LabelTemplate };
type SheetChoice = PaperSizeId | "custom";
type CopyRow = { orderId: string; copies: number };

const emptyMargins = { topMm: 5, rightMm: 5, bottomMm: 5, leftMm: 5 };

function listedTemplates(template: LabelTemplate): NamedLabelTemplate[] {
  if (template.library?.length) return template.library;
  return [{ id: "active", name: "Current template", isDefault: true, page: template.page, elements: template.elements }];
}

function pageMm(page: LabelTemplate["page"]) {
  return {
    widthMm: page.widthMm ?? (page.widthPt * 25.4) / 72,
    heightMm: page.heightMm ?? (page.heightPt * 25.4) / 72,
  };
}

async function postSheet(body: unknown) {
  const response = await fetch("/api/v1/label-template/multi-sheet", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/pdf")) return response.blob();
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new ApiError(payload.message || "Could not build the sheet.", response.status);
  return payload;
}

export function MultiPrintScreen() {
  const templates = useQuery({
    queryKey: ["label-template"],
    queryFn: () => api<TemplateResponse>("/api/v1/label-template"),
  });
  const orders = useQuery({
    queryKey: ["orders", "multi-print"],
    queryFn: () => api<Paginated<OrderRecord>>("/api/v1/orders?page=1&pageSize=8"),
  });
  const station = usePrintStation();
  const library = useMemo(
    () => (templates.data ? listedTemplates(templates.data.template) : []),
    [templates.data]
  );
  const [templateId, setTemplateId] = useState("");
  const [paper, setPaper] = useState<SheetChoice>("A4");
  const [customWidth, setCustomWidth] = useState("300");
  const [customHeight, setCustomHeight] = useState("400");
  const [margins, setMargins] = useState(emptyMargins);
  const [gapX, setGapX] = useState("2");
  const [gapY, setGapY] = useState("2");
  const [rotation, setRotation] = useState<MultiUpRotation | "auto">("auto");
  const [scale, setScale] = useState("1");
  const [columns, setColumns] = useState("");
  const [rows, setRows] = useState("");
  const [draftOrder, setDraftOrder] = useState("");
  const [draftCopies, setDraftCopies] = useState("1");
  const [items, setItems] = useState<CopyRow[]>([]);
  const [sheetPage, setSheetPage] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | "print" | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectedId = library.some((item) => item.id === templateId) ? templateId : (library[0]?.id ?? "");
  const selected = library.find((item) => item.id === selectedId);
  const label = selected ? pageMm(selected.page) : null;
  const preset = isPaperSizeId(paper) ? PAGE_PRESETS.find((item) => item.id === paper) : null;
  const sheetWidthMm = preset?.widthMm ?? Number(customWidth);
  const sheetHeightMm = preset?.heightMm ?? Number(customHeight);
  const layout = useMemo(() => {
    if (!label || !(sheetWidthMm > 0) || !(sheetHeightMm > 0)) return null;
    return calculateMultiUpLayout({
      sheetWidthMm,
      sheetHeightMm,
      labelWidthMm: label.widthMm,
      labelHeightMm: label.heightMm,
      margins,
      gaps: { horizontalMm: Number(gapX) || 0, verticalMm: Number(gapY) || 0 },
      rotation,
      scale: Number(scale) || 1,
      columns: columns.trim() ? Number(columns) : null,
      rows: rows.trim() ? Number(rows) : null,
      items,
    });
  }, [columns, gapX, gapY, label, margins, rotation, rows, scale, sheetHeightMm, sheetWidthMm, items]);

  const pages = layout?.ok ? Math.max(1, ...layout.placements.map((item) => item.page + 1)) : 1;
  const pageIndex = Math.min(sheetPage, pages - 1);
  const viewWidth = 460;
  const viewScale = layout?.ok ? viewWidth / layout.sheetWidthPt : 1;
  const agentPaper = station.data?.paperSize ?? "";
  const canPrint = paper !== "custom" && Boolean(station.data?.connected) && agentPaper === paper && Boolean(layout?.ok);

  function addItem(orderId: string, copies = Number(draftCopies) || 1) {
    const key = orderId.trim();
    if (!key) return;
    setItems((current) => [...current, { orderId: key, copies: Math.max(1, Math.floor(copies)) }]);
    setDraftOrder("");
  }

  function requestBody() {
    return {
      templateId: selectedId || undefined,
      items,
      sheet: {
        paperSize: paper,
        widthMm: sheetWidthMm,
        heightMm: sheetHeightMm,
        margins,
        gaps: { horizontalMm: Number(gapX) || 0, verticalMm: Number(gapY) || 0 },
        rotation,
        scale: Number(scale) || 1,
        columns: columns.trim() ? Number(columns) : null,
        rows: rows.trim() ? Number(rows) : null,
      },
    };
  }

  async function preview() {
    setBusy("preview");
    try {
      const result = await postSheet({ ...requestBody(), disposition: "inline" });
      if (!(result instanceof Blob)) return;
      const href = URL.createObjectURL(result);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return href;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not preview the sheet.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    try {
      const result = await postSheet({ ...requestBody(), disposition: "attachment" });
      if (!(result instanceof Blob)) return;
      const href = URL.createObjectURL(result);
      const link = document.createElement("a");
      link.href = href;
      link.download = "shipping-labels.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the sheet.");
    } finally {
      setBusy(null);
    }
  }

  async function print() {
    setBusy("print");
    try {
      const result = await postSheet({ ...requestBody(), disposition: "print" });
      if (result instanceof Blob) return;
      toast.success(result.message || "Sheet sent to the printer.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not print the sheet.");
    } finally {
      setBusy(null);
    }
  }

  if (!multiUpPrintEnabled()) {
    return (
      <PageHeader
        title="Multi print"
        description="Multi-up printing is turned off."
      />
    );
  }

  const recent = asPaginated<OrderRecord>(orders.data, ["orders", "items"]).items;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Multi print"
        description="Place finished shipping labels on one sheet. The label itself is not rearranged."
      />
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Template</span>
            <select
              className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-card px-3 text-sm"
              value={selectedId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {library.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Sheet</span>
            <select
              className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-card px-3 text-sm"
              value={paper}
              onChange={(event) => setPaper(event.target.value as SheetChoice)}
            >
              {PAGE_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          {paper === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <Input value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} aria-label="Sheet width mm" />
              <Input value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} aria-label="Sheet height mm" />
            </div>
          ) : null}
          <div className="grid grid-cols-4 gap-2">
            {(["topMm", "rightMm", "bottomMm", "leftMm"] as const).map((key) => (
              <label key={key} className="space-y-1 text-xs text-muted">
                {key.replace("Mm", "")}
                <Input
                  value={String(margins[key])}
                  onChange={(event) => setMargins((current) => ({ ...current, [key]: Number(event.target.value) || 0 }))}
                  aria-label={`${key} margin`}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted">
              Horizontal gap
              <Input value={gapX} onChange={(event) => setGapX(event.target.value)} aria-label="Horizontal gap mm" />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Vertical gap
              <Input value={gapY} onChange={(event) => setGapY(event.target.value)} aria-label="Vertical gap mm" />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-xs text-muted">
              Rotation
              <select
                className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-card px-2 text-sm"
                value={String(rotation)}
                onChange={(event) => {
                  const value = event.target.value;
                  setRotation(value === "0" ? 0 : value === "90" ? 90 : "auto");
                }}
              >
                <option value="auto">Auto</option>
                <option value="0">0°</option>
                <option value="90">90°</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">
              Scale
              <Input value={scale} onChange={(event) => setScale(event.target.value)} aria-label="Scale" />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Columns
              <Input value={columns} onChange={(event) => setColumns(event.target.value)} placeholder="Auto" aria-label="Columns" />
            </label>
          </div>
          <label className="block space-y-1 text-xs text-muted">
            Rows
            <Input value={rows} onChange={(event) => setRows(event.target.value)} placeholder="Auto" aria-label="Rows" />
          </label>
          <div className="flex gap-2">
            <Input value={draftOrder} onChange={(event) => setDraftOrder(event.target.value)} placeholder="Order ID" aria-label="Order ID" />
            <Input className="w-20" value={draftCopies} onChange={(event) => setDraftCopies(event.target.value)} aria-label="Copies" />
            <Button type="button" variant="secondary" onClick={() => addItem(draftOrder)}>
              Add
            </Button>
          </div>
          {recent.length ? (
            <div className="flex flex-wrap gap-2">
              {recent.map((order) => {
                const number = order.orderNumber || order.order_number || order.id;
                return (
                  <Button key={order.id} type="button" variant="ghost" size="sm" onClick={() => addItem(number, 1)}>
                    {number}
                  </Button>
                );
              })}
            </div>
          ) : null}
          <ul className="space-y-1 text-sm">
            {items.map((item, index) => (
              <li key={`${item.orderId}-${index}`} className="flex items-center justify-between gap-2">
                <span>
                  {item.orderId} × {item.copies}
                </span>
                <button type="button" className="text-xs text-muted" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={preview} disabled={Boolean(busy) || !items.length || layout?.ok === false}>
              {busy === "preview" ? "Building…" : "Preview PDF"}
            </Button>
            <Button type="button" variant="secondary" onClick={download} disabled={Boolean(busy) || !items.length || layout?.ok === false}>
              Download
            </Button>
            <Button type="button" variant="secondary" onClick={print} disabled={Boolean(busy) || !canPrint}>
              Print
            </Button>
          </div>
          <p className="text-xs text-muted">
            {paper === "custom"
              ? "Custom sheets can be previewed and downloaded."
              : station.data?.connected
                ? `Printer paper is ${agentPaper || "unset"}.`
                : "Printer unavailable. Download the sheet PDF instead."}
          </p>
        </div>
        <div className="space-y-4">
          {layout && !layout.ok ? <p className="text-sm text-red-700">{layout.message}</p> : null}
          {layout?.ok ? (
            <div>
              <div className="mb-2 flex gap-2">
                {Array.from({ length: pages }, (_, index) => (
                  <Button key={index} type="button" size="sm" variant={pageIndex === index ? "primary" : "secondary"} onClick={() => setSheetPage(index)}>
                    Sheet {index + 1}
                  </Button>
                ))}
              </div>
              <div
                className="relative border border-zinc-900 bg-white"
                style={{ width: layout.sheetWidthPt * viewScale, height: layout.sheetHeightPt * viewScale }}
              >
                <div
                  className="pointer-events-none absolute border border-dashed border-sky-500"
                  style={{
                    left: ptFromMm(margins.leftMm) * viewScale,
                    top: ptFromMm(margins.topMm) * viewScale,
                    right: ptFromMm(margins.rightMm) * viewScale,
                    bottom: ptFromMm(margins.bottomMm) * viewScale,
                  }}
                />
                {layout.placements
                  .filter((placement) => placement.page === pageIndex)
                  .map((placement) => (
                    <div
                      key={placement.index}
                      className="absolute flex items-center justify-center overflow-hidden border border-zinc-400 bg-zinc-50 text-[11px] text-zinc-700"
                      style={{
                        left: placement.xPt * viewScale,
                        top: placement.yPt * viewScale,
                        width: placement.widthPt * viewScale,
                        height: placement.heightPt * viewScale,
                      }}
                    >
                      {placement.orderId}
                    </div>
                  ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                {layout.columns} × {layout.rows}
                {layout.rotation ? `, rotated ${layout.rotation}°` : ""}
              </p>
            </div>
          ) : null}
          {previewUrl ? <iframe title="Sheet PDF preview" src={previewUrl} className="h-[720px] w-full border border-border bg-white" /> : null}
        </div>
      </div>
    </div>
  );
}
