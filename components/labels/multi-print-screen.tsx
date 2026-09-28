"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { asPaginated } from "@/lib/dashboard/records";
import { ApiError, api } from "@/lib/hooks/use-api";
import { usePrintStation } from "@/lib/hooks/use-print-station";
import { cn } from "@/lib/utils";
import { ptFromMm } from "@/modules/labels/layout/units";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";
import {
  alignBottom,
  alignCenterX,
  alignLeft,
  alignMiddleY,
  alignRight,
  alignTop,
  boxesIntersect,
  clampGroupDelta,
  marqueeRect,
  type SlotBox,
} from "@/modules/labels/multi-up/align";
import { nextGroupFromList, sheetGroups } from "@/modules/labels/multi-up/group";
import {
  applyPlacementOverrides,
  calculateMultiUpLayout,
  type MultiUpPlacementOverride,
  type MultiUpRotation,
} from "@/modules/labels/multi-up/layout";
import { A4_FOUR_UP, a4FourUpSpacing } from "@/modules/labels/multi-up/presets";
import { SHEET_PRESETS, isSheetSizeId, type SheetSizeId } from "@/modules/labels/page-presets";
import type { LabelTemplate, NamedLabelTemplate } from "@/modules/labels/template-schema";
import type { LabelRecord, Paginated } from "@/types/api";

type TemplateResponse = { template: LabelTemplate };
type SheetChoice = SheetSizeId | "custom";
type CopyRow = { orderId: string; copies: number };
type LayoutMode = "a4-4" | "manual";

const emptyMargins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
const CANVAS_ZOOM_MIN = 0.25;
const CANVAS_ZOOM_MAX = 4;
const VIEW_WIDTH = 460;
const MIN_SLOT_PT = 20;

function clampCanvasZoom(value: number) {
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, Math.round(value * 100) / 100));
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function spaceOpensPan(target: EventTarget | null) {
  if (isTypingTarget(target)) return false;
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest("[data-label-canvas]")) return true;
  return !target.closest("button, a, input, textarea, select, [role='tab']");
}

function aspectResize(origin: SlotBox, dx: number, dy: number, sheetWidthPt: number, sheetHeightPt: number): SlotBox {
  const scaleX = (origin.widthPt + dx) / origin.widthPt;
  const scaleY = (origin.heightPt + dy) / origin.heightPt;
  let nextScale = Math.abs(dx) >= Math.abs(dy) ? scaleX : scaleY;
  const minScale = Math.max(MIN_SLOT_PT / origin.widthPt, MIN_SLOT_PT / origin.heightPt);
  const maxWidth = Math.max(MIN_SLOT_PT, sheetWidthPt - origin.xPt);
  const maxHeight = Math.max(MIN_SLOT_PT, sheetHeightPt - origin.yPt);
  const maxScale = Math.min(maxWidth / origin.widthPt, maxHeight / origin.heightPt);
  nextScale = maxScale < minScale ? maxScale : Math.min(maxScale, Math.max(minScale, nextScale));
  if (!(nextScale > 0)) nextScale = 1;
  return {
    xPt: origin.xPt,
    yPt: origin.yPt,
    widthPt: origin.widthPt * nextScale,
    heightPt: origin.heightPt * nextScale,
  };
}

function listedTemplates(template: LabelTemplate): NamedLabelTemplate[] {
  if (template.library?.length) return template.library;
  return [{ id: "active", name: "Current template", isDefault: true, page: template.page, elements: template.elements }];
}

function generatedOrderNumber(row: LabelRecord) {
  const barcodeState = String(row.barcodeStatus ?? row.barcode_status ?? "").toUpperCase();
  const packingState = String(row.packingStatus ?? row.packing_status ?? "").toUpperCase();
  const status = String(row.status ?? "").toUpperCase();
  const generated = barcodeState === "READY" || packingState === "READY" || status === "READY";
  if (!generated) return "";
  return (row.orderNumber || row.order_number || "").trim();
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
  const labels = useQuery({
    queryKey: ["labels", "multi-print"],
    queryFn: () => api<Paginated<LabelRecord>>("/api/v1/labels?page=1&pageSize=24"),
  });
  const station = usePrintStation();
  const library = useMemo(
    () => (templates.data ? listedTemplates(templates.data.template) : []),
    [templates.data]
  );
  const [templateId, setTemplateId] = useState("");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("a4-4");
  const [paper, setPaper] = useState<SheetChoice>("A4");
  const [customWidth, setCustomWidth] = useState("300");
  const [customHeight, setCustomHeight] = useState("400");
  const [margins, setMargins] = useState(emptyMargins);
  const [gapX, setGapX] = useState("0");
  const [gapY, setGapY] = useState("0");
  const [rotation, setRotation] = useState<MultiUpRotation | "auto">(0);
  const [scale, setScale] = useState("1");
  const [columns, setColumns] = useState("2");
  const [rows, setRows] = useState("2");
  const [draftOrder, setDraftOrder] = useState("");
  const [draftCopies, setDraftCopies] = useState("1");
  const [items, setItems] = useState<CopyRow[]>([]);
  const [sheetPage, setSheetPage] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | "print" | null>(null);
  const [manual, setManual] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, MultiUpPlacementOverride>>({});
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [marqueeBox, setMarqueeBox] = useState<SlotBox | null>(null);
  const [zoom, setZoom] = useState(1);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const canvasPane = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const spaceHeldRef = useRef(false);
  const pan = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const drag = useRef<{
    index: number;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origins: Array<{ index: number; box: SlotBox }>;
  } | null>(null);
  const marquee = useRef<{ x0: number; y0: number; additive: boolean } | null>(null);
  const canvasScaleRef = useRef(1);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (!spaceOpensPan(event.target)) return;
      event.preventDefault();
      spaceHeldRef.current = true;
      setSpaceHeld(true);
    };
    const releaseSpace = () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      releaseSpace();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpace);
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const active = pan.current;
      const pane = canvasPane.current;
      if (!active || !pane) return;
      pane.scrollLeft = active.scrollLeft - (event.clientX - active.startX);
      pane.scrollTop = active.scrollTop - (event.clientY - active.startY);
    };
    const onUp = () => {
      if (!pan.current) return;
      pan.current = null;
      setPanning(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const selectedId = library.some((item) => item.id === templateId) ? templateId : (library[0]?.id ?? "");
  const selected = library.find((item) => item.id === selectedId);
  const label = selected ? pageMm(selected.page) : null;
  const labeledOrders = useMemo(
    () =>
      [...new Set(asPaginated<LabelRecord>(labels.data, ["labels", "items"]).items.map(generatedOrderNumber).filter(Boolean))],
    [labels.data]
  );
  const presetSpacing = label && layoutMode === "a4-4" ? a4FourUpSpacing(label.widthMm, label.heightMm) : null;
  const activeMargins = presetSpacing?.margins ?? margins;
  const activeGapX = presetSpacing ? String(presetSpacing.gaps.horizontalMm) : gapX;
  const activeGapY = presetSpacing ? String(presetSpacing.gaps.verticalMm) : gapY;
  const preset = isSheetSizeId(paper) ? SHEET_PRESETS.find((item) => item.id === paper) : null;
  const sheetWidthMm = preset?.widthMm ?? Number(customWidth);
  const sheetHeightMm = preset?.heightMm ?? Number(customHeight);
  const layout = useMemo(() => {
    if (!label || !(sheetWidthMm > 0) || !(sheetHeightMm > 0)) return null;
    const fourUp = layoutMode === "a4-4";
    return calculateMultiUpLayout({
      sheetWidthMm: fourUp ? A4_FOUR_UP.sheetWidthMm : sheetWidthMm,
      sheetHeightMm: fourUp ? A4_FOUR_UP.sheetHeightMm : sheetHeightMm,
      labelWidthMm: label.widthMm,
      labelHeightMm: label.heightMm,
      margins: activeMargins,
      gaps: { horizontalMm: Number(activeGapX) || 0, verticalMm: Number(activeGapY) || 0 },
      rotation: fourUp ? A4_FOUR_UP.rotation : rotation,
      scale: fourUp ? A4_FOUR_UP.scale : Number(scale) || 1,
      columns: fourUp ? A4_FOUR_UP.columns : columns.trim() ? Number(columns) : null,
      rows: fourUp ? A4_FOUR_UP.rows : rows.trim() ? Number(rows) : null,
      items,
    });
  }, [columns, activeGapX, activeGapY, label, activeMargins, layoutMode, rotation, rows, scale, sheetHeightMm, sheetWidthMm, items]);

  const gridKey = useMemo(
    () =>
      JSON.stringify({
        sheetWidthMm,
        sheetHeightMm,
        margins: activeMargins,
        gapX: activeGapX,
        gapY: activeGapY,
        rotation,
        scale,
        columns,
        rows,
        items,
        labelWidth: label?.widthMm ?? 0,
        labelHeight: label?.heightMm ?? 0,
      }),
    [columns, activeGapX, activeGapY, items, label, activeMargins, rotation, rows, scale, sheetHeightMm, sheetWidthMm]
  );
  const gridKeyRef = useRef(gridKey);
  useEffect(() => {
    if (gridKeyRef.current === gridKey) return;
    gridKeyRef.current = gridKey;
    setOverrides({});
    setSelectedSlots([]);
  }, [gridKey]);

  const displayLayout = useMemo(() => {
    if (!layout?.ok) return layout;
    if (!Object.keys(overrides).length) return layout;
    return applyPlacementOverrides(layout, Object.values(overrides));
  }, [layout, overrides]);

  useEffect(() => {
    const pane = canvasPane.current;
    if (!pane || !layout?.ok) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current || pan.current) return;
      const prevZoom = zoomRef.current;
      const nextZoom = clampCanvasZoom(prevZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
      if (nextZoom === prevZoom) return;
      const ratio = nextZoom / prevZoom;
      const rect = pane.getBoundingClientRect();
      const x = event.clientX - rect.left + pane.scrollLeft;
      const y = event.clientY - rect.top + pane.scrollTop;
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        pane.scrollLeft = x * ratio - (event.clientX - rect.left);
        pane.scrollTop = y * ratio - (event.clientY - rect.top);
      });
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, [layout]);

  const pages = layout?.ok ? Math.max(1, ...layout.placements.map((item) => item.page + 1)) : 1;
  const pageIndex = Math.min(sheetPage, pages - 1);
  const fitScale = layout?.ok ? VIEW_WIDTH / layout.sheetWidthPt : 1;
  const canvasScale = fitScale * zoom;
  canvasScaleRef.current = canvasScale;
  const agentPaper = station.data?.paperSize ?? "";
  const canPrint = paper !== "custom" && Boolean(station.data?.connected) && agentPaper === paper && Boolean(layout?.ok);
  const labelCount = items.reduce((sum, item) => sum + item.copies, 0);
  const sheetOrders =
    displayLayout?.ok ? displayLayout.placements.filter((placement) => placement.page === pageIndex) : [];

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const active = marquee.current;
      const sheet = sheetRef.current;
      if (!active || !sheet) return;
      const scale = canvasScaleRef.current;
      const rect = sheet.getBoundingClientRect();
      setMarqueeBox(
        marqueeRect(active.x0, active.y0, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale)
      );
    };
    const onUp = (event: PointerEvent) => {
      const active = marquee.current;
      if (!active) return;
      marquee.current = null;
      const sheet = sheetRef.current;
      setMarqueeBox(null);
      if (!sheet || !displayLayout?.ok) return;
      const scale = canvasScaleRef.current;
      const rect = sheet.getBoundingClientRect();
      const box = marqueeRect(
        active.x0,
        active.y0,
        (event.clientX - rect.left) / scale,
        (event.clientY - rect.top) / scale
      );
      if (box.widthPt < 2 && box.heightPt < 2) {
        if (!active.additive) setSelectedSlots([]);
        return;
      }
      const hits = displayLayout.placements
        .filter((placement) => placement.page === pageIndex && boxesIntersect(box, placement))
        .map((placement) => placement.index);
      setSelectedSlots((current) => (active.additive ? [...new Set([...current, ...hits])] : hits));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [displayLayout, pageIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!manual || isTypingTarget(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      if (!selectedSlots.length || !layout?.ok || !displayLayout?.ok) return;
      event.preventDefault();
      const step = ptFromMm(event.shiftKey ? 5 : 1);
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const origins = selectedSlots
        .map((index) => {
          const placement = displayLayout.placements.find((item) => item.index === index);
          return placement
            ? { index, box: { xPt: placement.xPt, yPt: placement.yPt, widthPt: placement.widthPt, heightPt: placement.heightPt } }
            : null;
        })
        .filter((item): item is { index: number; box: SlotBox } => Boolean(item));
      if (!origins.length) return;
      const delta = clampGroupDelta(
        origins.map((item) => item.box),
        dx,
        dy,
        layout.sheetWidthPt,
        layout.sheetHeightPt
      );
      setOverrides((current) => {
        const next = { ...current };
        for (const origin of origins) {
          next[origin.index] = {
            index: origin.index,
            xPt: origin.box.xPt + delta.dx,
            yPt: origin.box.yPt + delta.dy,
            widthPt: origin.box.widthPt,
            heightPt: origin.box.heightPt,
          };
        }
        return next;
      });
      markManual();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayLayout, layout, manual, selectedSlots]);

  function markManual() {
    if (layoutMode === "a4-4" && label) {
      const spacing = a4FourUpSpacing(label.widthMm, label.heightMm);
      setMargins(spacing.margins);
      setGapX(String(spacing.gaps.horizontalMm));
      setGapY(String(spacing.gaps.verticalMm));
    }
    setLayoutMode("manual");
  }

  function applyA4FourUpPreset() {
    setPaper("A4");
    setColumns(String(A4_FOUR_UP.columns));
    setRows(String(A4_FOUR_UP.rows));
    setRotation(A4_FOUR_UP.rotation);
    setScale(String(A4_FOUR_UP.scale));
    setManual(false);
    setOverrides({});
    setSelectedSlots([]);
    setLayoutMode("a4-4");
  }

  function highlightOrder(orderId: string) {
    if (!displayLayout?.ok) return;
    const placement = displayLayout.placements.find((item) => item.orderId === orderId);
    if (!placement) return;
    setSheetPage(placement.page);
    setSelectedSlots([placement.index]);
  }

  function onChipClick(orderId: string) {
    const selectedIds = items.map((item) => item.orderId);
    if (selectedIds.includes(orderId)) {
      highlightOrder(orderId);
      return;
    }
    const added = nextGroupFromList(labeledOrders, orderId, selectedIds);
    if (!added.length) return;
    setItems((current) => [...current, ...added.map((id) => ({ orderId: id, copies: 1 }))]);
  }

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
        paperSize: layoutMode === "a4-4" ? A4_FOUR_UP.paperSize : paper,
        widthMm: layoutMode === "a4-4" ? A4_FOUR_UP.sheetWidthMm : sheetWidthMm,
        heightMm: layoutMode === "a4-4" ? A4_FOUR_UP.sheetHeightMm : sheetHeightMm,
        margins: activeMargins,
        gaps: { horizontalMm: Number(activeGapX) || 0, verticalMm: Number(activeGapY) || 0 },
        rotation: layoutMode === "a4-4" ? A4_FOUR_UP.rotation : rotation,
        scale: layoutMode === "a4-4" ? A4_FOUR_UP.scale : Number(scale) || 1,
        columns: layoutMode === "a4-4" ? A4_FOUR_UP.columns : columns.trim() ? Number(columns) : null,
        rows: layoutMode === "a4-4" ? A4_FOUR_UP.rows : rows.trim() ? Number(rows) : null,
        placements: Object.values(overrides),
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

  function startPan(event: React.PointerEvent<HTMLElement>) {
    const pane = canvasPane.current;
    if (!pane) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
    marquee.current = null;
    pan.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: pane.scrollLeft,
      scrollTop: pane.scrollTop,
    };
    setPanning(true);
  }

  function pointerSheetPt(event: { clientX: number; clientY: number }) {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    const rect = sheet.getBoundingClientRect();
    return {
      xPt: (event.clientX - rect.left) / canvasScale,
      yPt: (event.clientY - rect.top) / canvasScale,
    };
  }

  function onCanvasPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (spaceHeldRef.current || event.button === 1) {
      startPan(event);
      return;
    }
    if (!manual) {
      if (event.currentTarget === event.target) setSelectedSlots([]);
      return;
    }
    if (event.currentTarget !== event.target) return;
    const point = pointerSheetPt(event);
    if (!point) return;
    event.preventDefault();
    markManual();
    marquee.current = {
      x0: point.xPt,
      y0: point.yPt,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    };
    setMarqueeBox(marqueeRect(point.xPt, point.yPt, point.xPt, point.yPt));
  }

  function slotOrigin(index: number) {
    if (!displayLayout?.ok) return null;
    const placement = displayLayout.placements.find((item) => item.index === index);
    if (!placement) return null;
    return { xPt: placement.xPt, yPt: placement.yPt, widthPt: placement.widthPt, heightPt: placement.heightPt };
  }

  function onSlotPointerDown(index: number, event: React.PointerEvent<HTMLElement>) {
    if (!manual) return;
    if (spaceHeldRef.current || event.button === 1) {
      startPan(event);
      return;
    }
    const origin = slotOrigin(index);
    if (!origin) return;
    event.stopPropagation();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      setSelectedSlots((current) =>
        current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
      );
      return;
    }
    const group = selectedSlots.includes(index) ? selectedSlots : [index];
    if (!selectedSlots.includes(index)) setSelectedSlots([index]);
    markManual();
    const origins = group
      .map((item) => {
        const box = slotOrigin(item);
        return box ? { index: item, box } : null;
      })
      .filter((item): item is { index: number; box: SlotBox } => Boolean(item));
    drag.current = { index, mode: "move", startX: event.clientX, startY: event.clientY, origins };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The move still tracks the pointer when capture is unavailable.
    }
  }

  function onResizeStart(index: number, event: React.PointerEvent<HTMLElement>) {
    if (!manual) return;
    if (spaceHeldRef.current || event.button === 1) {
      startPan(event);
      return;
    }
    const origin = slotOrigin(index);
    if (!origin) return;
    event.stopPropagation();
    drag.current = { index, mode: "resize", startX: event.clientX, startY: event.clientY, origins: [{ index, box: origin }] };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Resize still follows the pointer when capture is unavailable.
    }
  }

  function onSlotPointerMove(index: number, event: React.PointerEvent<HTMLElement>) {
    if (pan.current || spaceHeldRef.current) return;
    const active = drag.current;
    if (!active || active.index !== index || !layout?.ok) return;
    const dx = (event.clientX - active.startX) / canvasScale;
    const dy = (event.clientY - active.startY) / canvasScale;
    if (active.mode === "resize") {
      const origin = active.origins[0]?.box;
      if (!origin) return;
      const next = aspectResize(origin, dx, dy, layout.sheetWidthPt, layout.sheetHeightPt);
      setOverrides((current) => ({ ...current, [index]: { index, ...next } }));
      return;
    }
    const delta = clampGroupDelta(
      active.origins.map((item) => item.box),
      dx,
      dy,
      layout.sheetWidthPt,
      layout.sheetHeightPt
    );
    setOverrides((current) => {
      const next = { ...current };
      for (const origin of active.origins) {
        next[origin.index] = {
          index: origin.index,
          xPt: origin.box.xPt + delta.dx,
          yPt: origin.box.yPt + delta.dy,
          widthPt: origin.box.widthPt,
          heightPt: origin.box.heightPt,
        };
      }
      return next;
    });
  }

  function endDrag() {
    drag.current = null;
  }

  function applyAlign(align: (boxes: SlotBox[]) => SlotBox[]) {
    if (!displayLayout?.ok || selectedSlots.length < 2) return;
    const ordered = selectedSlots
      .map((index) => {
        const placement = displayLayout.placements.find((item) => item.index === index);
        return placement
          ? { index, box: { xPt: placement.xPt, yPt: placement.yPt, widthPt: placement.widthPt, heightPt: placement.heightPt } }
          : null;
      })
      .filter((item): item is { index: number; box: SlotBox } => Boolean(item));
    const aligned = align(ordered.map((item) => item.box));
    const nextLayout = applyPlacementOverrides(
      displayLayout,
      ordered.map((item, offset) => ({ index: item.index, ...aligned[offset]! }))
    );
    setOverrides((current) => {
      const next = { ...current };
      for (const placement of nextLayout.placements) {
        if (!selectedSlots.includes(placement.index)) continue;
        next[placement.index] = {
          index: placement.index,
          xPt: placement.xPt,
          yPt: placement.yPt,
          widthPt: placement.widthPt,
          heightPt: placement.heightPt,
        };
      }
      return next;
    });
    markManual();
  }

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
          <p className="text-sm text-muted">{layoutMode === "a4-4" ? `Preset: ${A4_FOUR_UP.name}` : "Custom / Manual"}</p>
          <Button type="button" variant={layoutMode === "a4-4" ? "primary" : "secondary"} onClick={applyA4FourUpPreset}>
            {A4_FOUR_UP.name}
          </Button>
          <p className="text-sm">
            Selected: {labelCount} {labelCount === 1 ? "label" : "labels"}
            {layout?.ok ? ` · Sheets: ${pages}` : ""}
          </p>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">Sheet</span>
            <select
              className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-card px-3 text-sm"
              value={paper}
              onChange={(event) => {
                markManual();
                setPaper(event.target.value as SheetChoice);
              }}
            >
              {SHEET_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          {paper === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <Input value={customWidth} onChange={(event) => { markManual(); setCustomWidth(event.target.value); }} aria-label="Sheet width mm" />
              <Input value={customHeight} onChange={(event) => { markManual(); setCustomHeight(event.target.value); }} aria-label="Sheet height mm" />
            </div>
          ) : null}
          <div className="grid grid-cols-4 gap-2">
            {(["topMm", "rightMm", "bottomMm", "leftMm"] as const).map((key) => (
              <label key={key} className="space-y-1 text-xs text-muted">
                {key.replace("Mm", "")}
                <Input
                  value={String(activeMargins[key])}
                  onChange={(event) => {
                    markManual();
                    setMargins((current) => ({ ...current, [key]: Number(event.target.value) || 0 }));
                  }}
                  aria-label={`${key} margin`}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted">
              Horizontal gap
              <Input value={activeGapX} onChange={(event) => { markManual(); setGapX(event.target.value); }} aria-label="Horizontal gap mm" />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Vertical gap
              <Input value={activeGapY} onChange={(event) => { markManual(); setGapY(event.target.value); }} aria-label="Vertical gap mm" />
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
                  markManual();
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
              <Input value={scale} onChange={(event) => { markManual(); setScale(event.target.value); }} aria-label="Scale" />
            </label>
            <label className="space-y-1 text-xs text-muted">
              Columns
              <Input value={columns} onChange={(event) => { markManual(); setColumns(event.target.value); }} placeholder="Auto" aria-label="Columns" />
            </label>
          </div>
          <label className="block space-y-1 text-xs text-muted">
            Rows
            <Input value={rows} onChange={(event) => { markManual(); setRows(event.target.value); }} placeholder="Auto" aria-label="Rows" />
          </label>
          <div className="flex gap-2">
            <Input value={draftOrder} onChange={(event) => setDraftOrder(event.target.value)} placeholder="Order ID" aria-label="Order ID" />
            <Input className="w-20" value={draftCopies} onChange={(event) => setDraftCopies(event.target.value)} aria-label="Copies" />
            <Button type="button" variant="secondary" onClick={() => addItem(draftOrder)}>
              Add
            </Button>
          </div>
          {labeledOrders.length ? (
            <div className="flex flex-wrap gap-2">
              {labeledOrders.map((number) => (
                <Button key={number} type="button" variant="ghost" size="sm" onClick={() => onChipClick(number)}>
                  {number}
                </Button>
              ))}
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
          {layout?.ok
            ? sheetGroups(
                layout.placements.map((placement) => placement.orderId),
                layout.perSheet
              ).map((group, sheetIndex) => (
                <div key={`sheet-group-${sheetIndex}`} className="space-y-1">
                  <p className="text-sm font-medium">
                    Sheet {sheetIndex + 1} · {group.length} {group.length === 1 ? "label" : "labels"}
                  </p>
                  <ol className="grid grid-cols-2 gap-1 text-sm">
                    {group.map((orderId, slot) => (
                      <li key={`${sheetIndex}-${slot}-${orderId}`}>
                        <button
                          type="button"
                          className="text-left text-muted hover:text-foreground"
                          onClick={() => {
                            setSheetPage(sheetIndex);
                            highlightOrder(orderId);
                          }}
                        >
                          {slot + 1}. {orderId}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            : null}
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
          {displayLayout?.ok ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={pageIndex <= 0} onClick={() => setSheetPage((page) => page - 1)}>
                  Previous
                </Button>
                <span className="text-sm">
                  Sheet {pageIndex + 1} of {pages}
                </span>
                <Button type="button" size="sm" variant="secondary" disabled={pageIndex >= pages - 1} onClick={() => setSheetPage((page) => page + 1)}>
                  Next
                </Button>
                {Array.from({ length: pages }, (_, index) => (
                  <Button key={index} type="button" size="sm" variant={pageIndex === index ? "primary" : "secondary"} onClick={() => setSheetPage(index)}>
                    Sheet {index + 1}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={manual ? "primary" : "secondary"}
                  aria-pressed={manual}
                  onClick={() => {
                    setManual((current) => {
                      if (!current) markManual();
                      return !current;
                    });
                  }}
                >
                  Select
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={!Object.keys(overrides).length} onClick={() => setOverrides({})}>
                  Reset to grid
                </Button>
                {selectedSlots.length >= 2 ? (
                  <>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyAlign(alignLeft)}>
                      Align left
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyAlign(alignCenterX)}>
                      Align center
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyAlign(alignRight)}>
                      Align right
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyAlign(alignTop)}>
                      Align top
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyAlign(alignMiddleY)}>
                      Align middle
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyAlign(alignBottom)}>
                      Align bottom
                    </Button>
                  </>
                ) : null}
              </div>
              {sheetOrders.length ? (
                <ol className="mb-3 grid grid-cols-2 gap-1 text-sm">
                  {sheetOrders.map((placement, slot) => (
                    <li key={placement.index}>
                      <button
                        type="button"
                        className={cn("text-left", selectedSlots.includes(placement.index) && "font-medium text-brand")}
                        onClick={() => setSelectedSlots([placement.index])}
                      >
                        {slot + 1}. {placement.orderId}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="overflow-hidden rounded-2xl border border-border bg-surface-soft">
                <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-card px-3 py-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label="Zoom out"
                    disabled={zoom <= CANVAS_ZOOM_MIN}
                    onClick={() => setZoom((value) => clampCanvasZoom(value / 1.15))}
                  >
                    −
                  </Button>
                  <span className="min-w-14 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label="Zoom in"
                    disabled={zoom >= CANVAS_ZOOM_MAX}
                    onClick={() => setZoom((value) => clampCanvasZoom(value * 1.15))}
                  >
                    +
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setZoom(1)}>
                    Fit
                  </Button>
                  <span className="text-xs text-muted">Select · Shift-click · Drag empty to marquee · Arrows to nudge</span>
                </div>
                <div
                  ref={canvasPane}
                  data-label-canvas
                  tabIndex={manual ? 0 : undefined}
                  className={cn(
                    "max-h-[720px] overflow-auto p-4 outline-none",
                    (spaceHeld || panning) && "select-none",
                    spaceHeld && !panning && "cursor-grab",
                    panning && "cursor-grabbing"
                  )}
                  onPointerDown={(event) => {
                    if (spaceHeldRef.current || event.button === 1) startPan(event);
                  }}
                  onAuxClick={(event) => event.preventDefault()}
                >
                  <div
                    ref={sheetRef}
                    className="relative mx-auto border border-zinc-900 bg-white"
                    style={{ width: displayLayout.sheetWidthPt * canvasScale, height: displayLayout.sheetHeightPt * canvasScale }}
                    onPointerDown={onCanvasPointerDown}
                  >
                    <div
                      className="pointer-events-none absolute border border-dashed border-sky-500"
                      style={{
                        left: ptFromMm(activeMargins.leftMm) * canvasScale,
                        top: ptFromMm(activeMargins.topMm) * canvasScale,
                        right: ptFromMm(activeMargins.rightMm) * canvasScale,
                        bottom: ptFromMm(activeMargins.bottomMm) * canvasScale,
                      }}
                    />
                    {marqueeBox ? (
                      <div
                        className="pointer-events-none absolute border border-dashed border-brand bg-brand/10"
                        style={{
                          left: marqueeBox.xPt * canvasScale,
                          top: marqueeBox.yPt * canvasScale,
                          width: marqueeBox.widthPt * canvasScale,
                          height: marqueeBox.heightPt * canvasScale,
                        }}
                      />
                    ) : null}
                    {displayLayout.placements
                      .filter((placement) => placement.page === pageIndex)
                      .map((placement) => {
                        const selected = selectedSlots.includes(placement.index);
                        return (
                          <div
                            key={placement.index}
                            role={manual ? "button" : undefined}
                            tabIndex={manual ? 0 : undefined}
                            aria-label={manual ? `Label ${placement.orderId}` : undefined}
                            className={cn(
                              "absolute overflow-hidden border-2 border-zinc-300 bg-white",
                              manual && (spaceHeld || panning ? "cursor-grab" : "cursor-grab active:cursor-grabbing"),
                              !manual && "pointer-events-none"
                            )}
                            style={{
                              left: placement.xPt * canvasScale,
                              top: placement.yPt * canvasScale,
                              width: placement.widthPt * canvasScale,
                              height: placement.heightPt * canvasScale,
                              containerType: "size",
                              outline: selected ? "2px solid var(--brand)" : undefined,
                              outlineOffset: 1,
                              touchAction: manual ? "none" : undefined,
                            }}
                            onPointerDown={manual ? (event) => onSlotPointerDown(placement.index, event) : undefined}
                            onPointerMove={manual ? (event) => onSlotPointerMove(placement.index, event) : undefined}
                            onPointerUp={manual ? endDrag : undefined}
                          >
                            <SheetSlotLabel
                              orderId={placement.orderId}
                              templateId={selectedId}
                              rotation={placement.rotation}
                            />
                            {selected && manual && selectedSlots.length === 1 ? (
                              <button
                                type="button"
                                aria-label="Resize label"
                                className="absolute bottom-0 right-0 z-10 size-3 cursor-se-resize bg-brand"
                                onPointerDown={(event) => onResizeStart(placement.index, event)}
                                onPointerMove={(event) => onSlotPointerMove(placement.index, event)}
                                onPointerUp={endDrag}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">
                {displayLayout.columns} × {displayLayout.rows}
                {displayLayout.rotation ? `, rotated ${displayLayout.rotation}°` : ""}
                {manual ? " · Select labels, marquee, drag, align, or use arrow keys." : ""}
              </p>
            </div>
          ) : null}
          {previewUrl ? <iframe title="Sheet PDF preview" src={previewUrl} className="h-[720px] w-full border border-border bg-white" /> : null}
        </div>
      </div>
    </div>
  );
}

function SheetSlotLabel({
  orderId,
  templateId,
  rotation,
}: {
  orderId: string;
  templateId: string;
  rotation: 0 | 90;
}) {
  const label = useQuery({
    queryKey: ["multi-print-label", templateId, orderId],
    queryFn: async () => {
      const response = await fetch("/api/v1/label-template/custom-preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          templateId: templateId && templateId !== "active" ? templateId : undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || "Could not load the label.");
      }
      return response.blob();
    },
  });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = label.data;
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setPdfUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [label.data]);

  if (!pdfUrl) {
    return (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-zinc-500">
        {label.isError ? label.error.message : ""}
      </span>
    );
  }

  const frame = `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`;
  if (rotation === 90) {
    return (
      <iframe
        title={orderId}
        src={frame}
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none border-0 bg-white"
        style={{
          width: "100cqh",
          height: "100cqw",
          transform: "translate(-50%, -50%) rotate(-90deg) scale(1.06)",
        }}
      />
    );
  }

  return (
    <iframe
      title={orderId}
      src={frame}
      className="pointer-events-none absolute inset-0 h-full w-full border-0 bg-white"
      style={{ transform: "scale(1.06)", transformOrigin: "center" }}
    />
  );
}
