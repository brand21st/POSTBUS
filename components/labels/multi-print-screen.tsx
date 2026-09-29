"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Grid2X2,
  HelpCircle,
  Layers3,
  Minus,
  MousePointer2,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { SmartGuideOverlay } from "@/components/labels/smart-guide-overlay";
import { usePdfFirstPageUrl } from "@/components/labels/pdf-raster-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { LABEL_4X6, generate4x6Presets, type FourBySixPreset } from "@/modules/labels/multi-up/presets";
import {
  applySmartSnap,
  emptySnapLocks,
  groupBounds,
  overlayForBox,
  shiftBox,
  snapThresholdPt,
  type SmartOverlay,
  type SnapLocks,
} from "@/modules/labels/multi-up/smart-guides";
import {
  MULTI_PRINT_PAPERS,
  isMultiPrintPaperId,
  multiPrintPaper,
  multiPrintPaperName,
  type MultiPrintPaperId,
} from "@/modules/labels/page-presets";
import type { LabelTemplate, NamedLabelTemplate } from "@/modules/labels/template-schema";
import type { LabelRecord, Paginated } from "@/types/api";

type TemplateResponse = { template: LabelTemplate };
type SheetChoice = MultiPrintPaperId | "custom";
type CopyRow = { orderId: string; copies: number };
type LayoutMode = "preset" | "manual";
type WorkflowStep = "labels" | "layout" | "review";

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

function presetCaption(preset: FourBySixPreset | null, fallback: string) {
  if (!preset) return fallback;
  return preset.name.includes(" × 4×6") ? `${preset.name} Labels` : preset.name;
}

function presetChoiceCopy(item: FourBySixPreset) {
  if (item.id === "A4-4-labels") {
    return { title: "4 labels", hint: "A4 2×2 · auto-fit 4×6" };
  }
  if (item.scale === 1 && item.labelWidthMm === LABEL_4X6.widthMm) {
    return { title: `${item.quantity} label${item.quantity === 1 ? "" : "s"}`, hint: "4×6 · full size" };
  }
  return { title: `${item.quantity} label${item.quantity === 1 ? "" : "s"}`, hint: `${item.columns}×${item.rows}` };
}

function pageMm(page: LabelTemplate["page"]) {
  return {
    widthMm: page.widthMm ?? (page.widthPt * 25.4) / 72,
    heightMm: page.heightMm ?? (page.heightPt * 25.4) / 72,
  };
}

function templateOptionLabel(item: NamedLabelTemplate) {
  const size = pageMm(item.page);
  return `${item.name} (${Math.round(size.widthMm)} × ${Math.round(size.heightMm)} mm)`;
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("preset");
  const [paper, setPaper] = useState<SheetChoice>("A4");
  const [presetQuantity, setPresetQuantity] = useState(2);
  const [customWidth, setCustomWidth] = useState("300");
  const [customHeight, setCustomHeight] = useState("400");
  const [margins, setMargins] = useState(emptyMargins);
  const [gapX, setGapX] = useState("0");
  const [gapY, setGapY] = useState("0");
  const [rotation, setRotation] = useState<MultiUpRotation | "auto">(0);
  const [scale, setScale] = useState("1");
  const [columns, setColumns] = useState("2");
  const [rows, setRows] = useState("1");
  const [draftOrder, setDraftOrder] = useState("");
  const [draftCopies, setDraftCopies] = useState("1");
  const [items, setItems] = useState<CopyRow[]>([]);
  const [sheetPage, setSheetPage] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | "print" | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("labels");
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [manual, setManual] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, MultiUpPlacementOverride>>({});
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [marqueeBox, setMarqueeBox] = useState<SlotBox | null>(null);
  const [zoom, setZoom] = useState(1);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dragOverlay, setDragOverlay] = useState<SmartOverlay | null>(null);
  const canvasPane = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const spaceHeldRef = useRef(false);
  const pan = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const drag = useRef<{
    index: number;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origins: Array<{ index: number; box: SlotBox }>;
    originBbox: SlotBox;
    others: SlotBox[];
    locked: SnapLocks;
  } | null>(null);
  const marquee = useRef<{ x0: number; y0: number; additive: boolean } | null>(null);
  const canvasScaleRef = useRef(1);
  const overrideFrame = useRef<number | null>(null);
  const pendingOverrides = useRef<Record<number, MultiUpPlacementOverride>>({});
  const pendingOverlay = useRef<SmartOverlay | null | undefined>(undefined);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (overrideFrame.current != null) cancelAnimationFrame(overrideFrame.current);
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
  const templateLabel = useMemo(() => (selected ? pageMm(selected.page) : null), [selected]);
  const labeledOrders = useMemo(
    () =>
      [...new Set(asPaginated<LabelRecord>(labels.data, ["labels", "items"]).items.map(generatedOrderNumber).filter(Boolean))],
    [labels.data]
  );
  const namedPaper = isMultiPrintPaperId(paper) ? multiPrintPaper(paper) : null;
  const sheetWidthMm = namedPaper?.widthMm ?? Number(customWidth);
  const sheetHeightMm = namedPaper?.heightMm ?? Number(customHeight);
  const fourBySixPresets = useMemo(
    () => generate4x6Presets(sheetWidthMm, sheetHeightMm, paper),
    [paper, sheetHeightMm, sheetWidthMm]
  );
  const chosenFourBySix =
    layoutMode === "preset"
      ? (fourBySixPresets.find((item) => item.quantity === presetQuantity) ?? fourBySixPresets.at(-1) ?? null)
      : null;
  const presetOn = Boolean(chosenFourBySix);
  const slotLabel = chosenFourBySix
    ? { widthMm: chosenFourBySix.labelWidthMm, heightMm: chosenFourBySix.labelHeightMm }
    : layoutMode === "preset"
      ? { widthMm: LABEL_4X6.widthMm, heightMm: LABEL_4X6.heightMm }
      : templateLabel;
  const activeMargins = chosenFourBySix?.margins ?? margins;
  const activeGapX = chosenFourBySix ? String(chosenFourBySix.gaps.horizontalMm) : gapX;
  const activeGapY = chosenFourBySix ? String(chosenFourBySix.gaps.verticalMm) : gapY;
  const layout = useMemo(() => {
    if (layoutMode === "preset" && !chosenFourBySix) {
      return { ok: false as const, message: "No valid 4×6 layout for this paper size." };
    }
    if (!slotLabel || !(sheetWidthMm > 0) || !(sheetHeightMm > 0)) return null;
    return calculateMultiUpLayout({
      sheetWidthMm,
      sheetHeightMm,
      labelWidthMm: slotLabel.widthMm,
      labelHeightMm: slotLabel.heightMm,
      margins: activeMargins,
      gaps: { horizontalMm: Number(activeGapX) || 0, verticalMm: Number(activeGapY) || 0 },
      rotation: presetOn ? 0 : rotation,
      scale: presetOn && chosenFourBySix ? chosenFourBySix.scale : Number(scale) || 1,
      columns: presetOn && chosenFourBySix ? chosenFourBySix.columns : columns.trim() ? Number(columns) : null,
      rows: presetOn && chosenFourBySix ? chosenFourBySix.rows : rows.trim() ? Number(rows) : null,
      items,
    });
  }, [
    activeGapX,
    activeGapY,
    activeMargins,
    chosenFourBySix,
    columns,
    items,
    presetOn,
    rotation,
    rows,
    scale,
    sheetHeightMm,
    sheetWidthMm,
    slotLabel,
    layoutMode,
  ]);

  const gridKey = useMemo(
    () =>
      JSON.stringify({
        sheetWidthMm,
        sheetHeightMm,
        margins: activeMargins,
        gapX: activeGapX,
        gapY: activeGapY,
        rotation: presetOn ? 0 : rotation,
        scale: presetOn && chosenFourBySix ? chosenFourBySix.scale : scale,
        columns: presetOn && chosenFourBySix ? chosenFourBySix.columns : columns,
        rows: presetOn && chosenFourBySix ? chosenFourBySix.rows : rows,
        items,
        labelWidth: slotLabel?.widthMm ?? 0,
        labelHeight: slotLabel?.heightMm ?? 0,
        layoutMode,
      }),
    [
      activeGapX,
      activeGapY,
      activeMargins,
      chosenFourBySix,
      columns,
      items,
      layoutMode,
      presetOn,
      rotation,
      rows,
      scale,
      sheetHeightMm,
      sheetWidthMm,
      slotLabel,
    ]
  );
  const gridKeyRef = useRef(gridKey);
  useEffect(() => {
    if (gridKeyRef.current === gridKey) return;
    gridKeyRef.current = gridKey;
    setOverrides({});
    setSelectedSlots([]);
  }, [gridKey]);

  useEffect(() => {
    if (layoutMode !== "preset" || !fourBySixPresets.length) return;
    if (fourBySixPresets.some((item) => item.quantity === presetQuantity)) return;
    setPresetQuantity(fourBySixPresets[fourBySixPresets.length - 1]!.quantity);
  }, [fourBySixPresets, layoutMode, presetQuantity]);

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
  useEffect(() => {
    canvasScaleRef.current = canvasScale;
  }, [canvasScale]);
  const agentPaper = station.data?.paperSize ?? "";
  const canPrint = paper !== "custom" && Boolean(station.data?.connected) && agentPaper === paper && Boolean(layout?.ok);
  const labelCount = items.reduce((sum, item) => sum + item.copies, 0);
  const sheetOrders =
    displayLayout?.ok ? displayLayout.placements.filter((placement) => placement.page === pageIndex) : [];
  const markManual = useCallback(() => {
    if (layoutMode === "preset" && chosenFourBySix) {
      setMargins(chosenFourBySix.margins);
      setGapX(String(chosenFourBySix.gaps.horizontalMm));
      setGapY(String(chosenFourBySix.gaps.verticalMm));
      setColumns(String(chosenFourBySix.columns));
      setRows(String(chosenFourBySix.rows));
      setRotation(0);
      setScale(String(chosenFourBySix.scale));
    }
    setLayoutMode("manual");
  }, [chosenFourBySix, layoutMode]);

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
  }, [displayLayout, layout, manual, selectedSlots, markManual]);

  function applyFourBySixPreset(quantity: number) {
    const next = fourBySixPresets.find((item) => item.quantity === quantity);
    if (!next) return;
    setPresetQuantity(next.quantity);
    setColumns(String(next.columns));
    setRows(String(next.rows));
    setRotation(0);
    setScale(String(next.scale));
    setManual(false);
    setOverrides({});
    setSelectedSlots([]);
    setLayoutMode("preset");
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
    const added = nextGroupFromList(
      labeledOrders,
      orderId,
      selectedIds,
      layout?.ok ? layout.perSheet : chosenFourBySix?.quantity ?? 4
    );
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
        paperSize: paper,
        widthMm: sheetWidthMm,
        heightMm: sheetHeightMm,
        labelWidthMm: presetOn && chosenFourBySix ? chosenFourBySix.labelWidthMm : undefined,
        labelHeightMm: presetOn && chosenFourBySix ? chosenFourBySix.labelHeightMm : undefined,
        margins: activeMargins,
        gaps: { horizontalMm: Number(activeGapX) || 0, verticalMm: Number(activeGapY) || 0 },
        rotation: presetOn ? 0 : rotation,
        scale: presetOn && chosenFourBySix ? chosenFourBySix.scale : Number(scale) || 1,
        columns: presetOn && chosenFourBySix ? chosenFourBySix.columns : columns.trim() ? Number(columns) : null,
        rows: presetOn && chosenFourBySix ? chosenFourBySix.rows : rows.trim() ? Number(rows) : null,
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
      setShowPdfPreview(true);
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
    const selected = new Set(origins.map((item) => item.index));
    const others =
      displayLayout?.ok
        ? displayLayout.placements
            .filter((placement) => placement.page === pageIndex && !selected.has(placement.index))
            .map((placement) => ({
              xPt: placement.xPt,
              yPt: placement.yPt,
              widthPt: placement.widthPt,
              heightPt: placement.heightPt,
            }))
        : [];
    const originBbox = groupBounds(origins.map((item) => item.box)) ?? origin;
    drag.current = {
      index,
      mode: "move",
      startX: event.clientX,
      startY: event.clientY,
      origins,
      originBbox,
      others,
      locked: emptySnapLocks(),
    };
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
    drag.current = {
      index,
      mode: "resize",
      startX: event.clientX,
      startY: event.clientY,
      origins: [{ index, box: origin }],
      originBbox: origin,
      others: [],
      locked: emptySnapLocks(),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Resize still follows the pointer when capture is unavailable.
    }
  }

  function queueOverridePatch(patch: Record<number, MultiUpPlacementOverride>, overlay?: SmartOverlay | null) {
    Object.assign(pendingOverrides.current, patch);
    if (overlay !== undefined) pendingOverlay.current = overlay;
    if (overrideFrame.current != null) return;
    overrideFrame.current = requestAnimationFrame(() => {
      const pending = pendingOverrides.current;
      pendingOverrides.current = {};
      const chrome = pendingOverlay.current;
      pendingOverlay.current = undefined;
      overrideFrame.current = null;
      setOverrides((current) => ({ ...current, ...pending }));
      if (chrome !== undefined) setDragOverlay(chrome);
    });
  }

  function flushOverridePatch() {
    if (overrideFrame.current != null) cancelAnimationFrame(overrideFrame.current);
    overrideFrame.current = null;
    const pending = pendingOverrides.current;
    pendingOverrides.current = {};
    const chrome = pendingOverlay.current;
    pendingOverlay.current = undefined;
    if (Object.keys(pending).length) setOverrides((current) => ({ ...current, ...pending }));
    if (chrome !== undefined) setDragOverlay(chrome);
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
      queueOverridePatch({ [index]: { index, ...next } });
      return;
    }
    const snapped = applySmartSnap({
      originBbox: active.originBbox,
      others: active.others,
      sheetWidthPt: layout.sheetWidthPt,
      sheetHeightPt: layout.sheetHeightPt,
      intendedDx: dx,
      intendedDy: dy,
      thresholdPt: snapThresholdPt(canvasScale),
      locked: active.locked,
    });
    active.locked = snapped.locked;
    const delta = clampGroupDelta(
      active.origins.map((item) => item.box),
      snapped.dx,
      snapped.dy,
      layout.sheetWidthPt,
      layout.sheetHeightPt
    );
    const patch: Record<number, MultiUpPlacementOverride> = {};
    for (const origin of active.origins) {
      patch[origin.index] = {
          index: origin.index,
          xPt: origin.box.xPt + delta.dx,
          yPt: origin.box.yPt + delta.dy,
          widthPt: origin.box.widthPt,
          heightPt: origin.box.heightPt,
      };
    }
    const finalBbox = shiftBox(active.originBbox, delta.dx, delta.dy);
    queueOverridePatch(
      patch,
      overlayForBox(finalBbox, active.others, layout.sheetWidthPt, layout.sheetHeightPt, snapped.overlay.guides)
    );
  }

  function endDrag() {
    flushOverridePatch();
    drag.current = null;
    setDragOverlay(null);
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

  const printerMessage =
    paper === "custom"
      ? "Custom sheets can be previewed and downloaded."
      : !station.data?.connected
        ? "Connect a printer to print."
        : agentPaper !== paper
          ? `Printer paper must match ${paper}.`
          : "Printer ready.";
  const selectedOrderIds = new Set(items.map((item) => item.orderId));

  const outputActions = (
    <>
      <Button type="button" variant="secondary" onClick={preview} disabled={Boolean(busy) || !items.length || layout?.ok === false}>
        <Eye />
        {busy === "preview" ? "Building…" : "Preview PDF"}
      </Button>
      <Button type="button" variant="secondary" onClick={download} disabled={Boolean(busy) || !items.length || layout?.ok === false}>
        <Download />
        Download PDF
      </Button>
      <Button type="button" onClick={print} disabled={Boolean(busy) || !canPrint}>
        <Printer />
        {busy === "print" ? "Sending…" : "Print"}
      </Button>
    </>
  );

  return (
    <div className="space-y-5 pb-20 sm:pb-0">
      <PageHeader
        title="Multi print labels"
        description="Choose generated labels, arrange them on a sheet, then preview or print one PDF."
        actions={<div className="hidden items-center gap-2 lg:flex">{outputActions}</div>}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
        {[
          { label: "Selected", value: `${labelCount} labels`, icon: FileText },
          { label: "Sheets", value: layout?.ok ? String(pages) : "—", icon: Layers3 },
          { label: "Layout", value: presetCaption(chosenFourBySix, layoutMode === "preset" ? "No 4×6 fit" : "Manual"), icon: Grid2X2 },
          {
            label: "Printer",
            value: canPrint ? "Ready" : station.data?.connected ? "Check paper" : "Offline",
            icon: Printer,
          },
        ].map(({ label: statLabel, value, icon: Icon }) => (
          <div key={statLabel} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-soft text-muted">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">{statLabel}</span>
              <span className="block truncate text-sm font-semibold text-ink">{value}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-hidden">
          <CardHeader className="border-b border-border p-4">
            <CardTitle>Prepare your sheets</CardTitle>
            <CardDescription>Three quick steps. Your choices stay in place while you move between them.</CardDescription>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface-soft p-1" role="tablist" aria-label="Multi print workflow">
              {([
                ["labels", "1", "Labels"],
                ["layout", "2", "Arrange"],
                ["review", "3", "Review"],
              ] as const).map(([step, number, labelText]) => {
                const complete = step === "labels" ? labelCount > 0 : step === "layout" ? Boolean(layout?.ok && labelCount) : Boolean(previewUrl);
                return (
                  <button
                    key={step}
                    type="button"
                    role="tab"
                    aria-selected={workflowStep === step}
                    onClick={() => setWorkflowStep(step)}
                    className={cn(
                      "flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all duration-200",
                      workflowStep === step ? "bg-card text-ink shadow-sm" : "text-muted hover:text-foreground"
                    )}
                  >
                    <span className={cn("flex size-5 items-center justify-center rounded-full text-[10px]", complete ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600")}>
                      {complete ? <CheckCircle2 className="size-3.5" /> : number}
                    </span>
                    <span className="truncate">{labelText}</span>
                  </button>
                );
              })}
            </div>
          </CardHeader>

          <CardContent className="max-h-[calc(100vh-13rem)] space-y-4 overflow-y-auto p-4">
            {workflowStep === "labels" ? (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-ink">1. Choose labels</h2>
                    <Badge variant="brand">{labelCount} selected</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">Only orders with a generated label appear here. Selecting a chip fills one sheet using the current 4×6 quantity.</p>
                </div>

                <div className="flex gap-2">
                  <Input value={draftOrder} onChange={(event) => setDraftOrder(event.target.value)} placeholder="Enter Order ID" aria-label="Order ID" />
                  <Input className="w-16" value={draftCopies} onChange={(event) => setDraftCopies(event.target.value)} aria-label="Copies" title="Copies" />
                  <Button type="button" size="icon" variant="secondary" onClick={() => addItem(draftOrder)} aria-label="Add order" title="Add order">
                    <Plus />
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted">Generated labels</p>
                  {labels.isLoading ? (
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-8 w-16 rounded-full" />)}
                    </div>
                  ) : labeledOrders.length ? (
                    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                      {labeledOrders.map((number) => {
                        const active = selectedOrderIds.has(number);
                        return (
                          <button
                            key={number}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChipClick(number)}
                            className={cn(
                              "rounded-full border px-2.5 py-1.5 text-xs font-medium transition-all duration-200",
                              active
                                ? "border-brand/30 bg-rose-50 text-brand-dark shadow-sm"
                                : "border-border bg-card text-foreground hover:border-zinc-300 hover:bg-surface-soft"
                            )}
                          >
                            {number}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-surface-soft p-4 text-center">
                      <FileText className="mx-auto size-5 text-muted" />
                      <p className="mt-2 text-sm font-medium">No generated labels yet</p>
                      <p className="mt-1 text-xs text-muted">Generate a shipping label, then return here.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted">Print order</p>
                    {items.length ? (
                      <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setItems([])}>
                        Clear all
                      </button>
                    ) : null}
                  </div>
                  {items.length ? (
                    <ul className="space-y-1.5">
                      {items.map((item, index) => (
                        <li key={`${item.orderId}-${index}`} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-soft text-[11px] font-semibold text-muted">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.orderId}</span>
                          <span className="text-xs text-muted">×{item.copies}</span>
                          <button
                            type="button"
                            className="rounded-md p-1 text-muted transition-colors hover:bg-red-50 hover:text-red-700"
                            onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                            aria-label={`Remove ${item.orderId}`}
                            title="Remove"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl bg-surface-soft px-3 py-3 text-xs text-muted">Select an Order ID above to start your first sheet.</p>
                  )}
                </div>

                <Button type="button" className="w-full" disabled={!items.length} onClick={() => setWorkflowStep("layout")}>
                  Arrange sheets
                  <ChevronRight />
                </Button>
              </>
            ) : null}

            {workflowStep === "layout" ? (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-ink">2. Arrange sheet</h2>
                    <Badge variant={presetOn ? "brand" : "outline"}>
                      {presetCaption(chosenFourBySix, layoutMode === "preset" ? "No 4×6 fit" : "Manual")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Paper size is independent of the 4×6 label ({Math.round(LABEL_4X6.widthMm)} × {Math.round(LABEL_4X6.heightMm)} mm). The A4 2×2 preset scales that template uniformly to fit; other presets stay at 100%.
                  </p>
                </div>

                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  Label template
                  <select className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-card px-3 text-sm text-foreground" value={selectedId} onChange={(event) => setTemplateId(event.target.value)}>
                    {library.map((item) => (
                      <option key={item.id} value={item.id}>
                        {templateOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-3 rounded-xl border border-border bg-surface-soft p-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">4×6 Multi-Print</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">
                      Choose paper, then a quantity that physically fits. Positions initialize once; you can still move and align labels after that.
                    </p>
                  </div>
                  <label className="block space-y-1.5 text-xs font-medium text-muted">
                    Paper
                    <select
                      className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-card px-3 text-sm text-foreground"
                      value={paper}
                      onChange={(event) => {
                        const next = event.target.value as SheetChoice;
                        setPaper(next);
                        if (layoutMode === "preset") {
                          setOverrides({});
                          setSelectedSlots([]);
                          setLayoutMode("preset");
                        }
                      }}
                    >
                      {MULTI_PRINT_PAPERS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                      <option value="custom">Custom size</option>
                    </select>
                  </label>
                  {paper === "custom" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-xs text-muted">Width (mm)<Input value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} /></label>
                      <label className="space-y-1 text-xs text-muted">Height (mm)<Input value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} /></label>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted">Available presets</p>
                    {fourBySixPresets.length ? (
                      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Label quantity preset">
                        {fourBySixPresets.map((item) => {
                          const selectedPreset = presetOn && chosenFourBySix?.id === item.id;
                          const copy = presetChoiceCopy(item);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="radio"
                              aria-checked={selectedPreset}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all duration-200",
                                selectedPreset
                                  ? "border-brand bg-brand text-white shadow-sm"
                                  : "border-border bg-card text-foreground hover:border-zinc-300 hover:bg-white dark:hover:border-zinc-700"
                              )}
                              onClick={() => applyFourBySixPreset(item.quantity)}
                            >
                              <span
                                className={cn(
                                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums",
                                  selectedPreset ? "bg-white/20" : "bg-surface-soft text-ink"
                                )}
                              >
                                {item.quantity}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold leading-5">{copy.title}</span>
                                <span className={cn("block truncate text-[11px] leading-4", selectedPreset ? "text-white/80" : "text-muted")}>
                                  {copy.hint}
                                </span>
                              </span>
                              {selectedPreset ? <CheckCircle2 className="size-4 shrink-0" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted">No valid 4×6 layout for this paper size.</p>
                    )}
                  </div>
                </div>

                <details className="group rounded-xl border border-border bg-card">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm font-medium">
                    <SlidersHorizontal className="size-4 text-muted" />
                    Advanced layout
                    <ChevronDown className="ml-auto size-4 text-muted transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="space-y-3 border-t border-border p-3">
                    <p className="text-xs text-muted">Change margins, gaps, rotation, label size, rows, or columns.</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(["topMm", "rightMm", "bottomMm", "leftMm"] as const).map((key) => (
                        <label key={key} className="space-y-1 text-[11px] capitalize text-muted">
                          {key.replace("Mm", "")} (mm)
                          <Input value={String(activeMargins[key])} onChange={(event) => { markManual(); setMargins((current) => ({ ...current, [key]: Number(event.target.value) || 0 })); }} />
                        </label>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-[11px] text-muted">Horizontal gap (mm)<Input value={activeGapX} onChange={(event) => { markManual(); setGapX(event.target.value); }} /></label>
                      <label className="space-y-1 text-[11px] text-muted">Vertical gap (mm)<Input value={activeGapY} onChange={(event) => { markManual(); setGapY(event.target.value); }} /></label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-[11px] text-muted">
                        Rotation
                        <select className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-card px-2 text-sm" value={String(rotation)} onChange={(event) => { markManual(); setRotation(event.target.value === "0" ? 0 : event.target.value === "90" ? 90 : "auto"); }}>
                          <option value="auto">Auto</option><option value="0">0°</option><option value="90">90°</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-[11px] text-muted">Label size (100% = 1)<Input value={scale} onChange={(event) => { markManual(); setScale(event.target.value); }} /></label>
                      <label className="space-y-1 text-[11px] text-muted">Columns<Input value={columns} onChange={(event) => { markManual(); setColumns(event.target.value); }} placeholder="Auto" /></label>
                      <label className="space-y-1 text-[11px] text-muted">Rows<Input value={rows} onChange={(event) => { markManual(); setRows(event.target.value); }} placeholder="Auto" /></label>
                    </div>
                  </div>
                </details>

                <div className="flex gap-2">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setWorkflowStep("labels")}><ChevronLeft />Labels</Button>
                  <Button type="button" className="flex-1" disabled={!layout?.ok || !items.length} onClick={() => setWorkflowStep("review")}>Review<ChevronRight /></Button>
                </div>
              </>
            ) : null}

            {workflowStep === "review" ? (
              <>
                <div>
                  <h2 className="text-sm font-semibold text-ink">3. Review & print</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">Confirm each sheet, preview the final PDF, then download or print it.</p>
                </div>

                <div className="rounded-xl border border-border bg-surface-soft p-3">
                  <div className="flex items-center justify-between text-sm"><span className="text-muted">Labels</span><strong>{labelCount}</strong></div>
                  <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted">Sheets</span><strong>{layout?.ok ? pages : "—"}</strong></div>
                  <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted">Paper</span><strong>{multiPrintPaperName(paper)}</strong></div>
                  <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted">Layout</span><strong>{presetCaption(chosenFourBySix, layoutMode === "preset" ? "No 4×6 fit" : "Manual")}</strong></div>
                </div>

                {layout?.ok ? (
                  <div className="space-y-2">
                    {sheetGroups(layout.placements.map((placement) => placement.orderId), layout.perSheet).map((group, sheetIndex) => (
                      <button
                        key={`sheet-group-${sheetIndex}`}
                        type="button"
                        onClick={() => setSheetPage(sheetIndex)}
                        className={cn(
                          "w-full rounded-xl border p-3 text-left transition-all duration-200",
                          pageIndex === sheetIndex ? "border-brand/30 bg-rose-50 shadow-sm" : "border-border bg-card hover:bg-surface-soft"
                        )}
                      >
                        <span className="flex items-center justify-between text-sm font-semibold">
                          Sheet {sheetIndex + 1}
                          <span className="text-xs font-normal text-muted">{group.length} labels</span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted">{group.join(", ")}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className={cn("rounded-xl border px-3 py-3 text-sm", canPrint ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-surface-soft text-muted")}>
                  <span className="flex items-center gap-2 font-medium">
                    <span className={cn("size-2 rounded-full", canPrint ? "animate-pulse-soft bg-emerald-500" : "bg-zinc-400")} />
                    {printerMessage}
                  </span>
                </div>

                <div className="grid gap-2">{outputActions}</div>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setWorkflowStep("layout")}><ChevronLeft />Back to arrangement</Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="border-b border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Sheet preview</CardTitle>
                <CardDescription>What you see here is the geometry used for preview, download, and print.</CardDescription>
              </div>
              <div className="flex items-center gap-1.5" role="group" aria-label="Sheet navigation">
                <Button type="button" size="icon" variant="secondary" disabled={pageIndex <= 0} onClick={() => setSheetPage((page) => page - 1)} aria-label="Previous sheet" title="Previous sheet"><ChevronLeft /></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="secondary">Sheet {pageIndex + 1} of {pages}<ChevronDown /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Go to sheet</DropdownMenuLabel>
                    {Array.from({ length: pages }, (_, index) => (
                      <DropdownMenuItem key={index} onClick={() => setSheetPage(index)}>
                        Sheet {index + 1}{index === pageIndex ? <CheckCircle2 className="ml-auto text-brand" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" size="icon" variant="secondary" disabled={pageIndex >= pages - 1} onClick={() => setSheetPage((page) => page + 1)} aria-label="Next sheet" title="Next sheet"><ChevronRight /></Button>
              </div>
            </div>
            {sheetOrders.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sheetOrders.map((placement, slot) => (
                  <button
                    key={placement.index}
                    type="button"
                    className={cn(
                      "rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
                      selectedSlots.includes(placement.index) ? "border-brand/30 bg-rose-50 text-brand-dark" : "border-border bg-card text-muted hover:text-foreground"
                    )}
                    onClick={() => setSelectedSlots([placement.index])}
                  >
                    {slot + 1}. {placement.orderId}
                  </button>
                ))}
              </div>
            ) : null}
          </CardHeader>

          {items.length && layout && !layout.ok ? (
            <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert" aria-live="polite">
              <strong>This layout does not fit.</strong>
              <p className="mt-1">{layout.message} Open Advanced layout to reduce label size or choose a larger sheet.</p>
            </div>
          ) : null}

          {displayLayout?.ok ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-soft px-3 py-2">
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
                  title="Select and move labels"
                >
                  <MousePointer2 />Select & move
                </Button>
                <Button type="button" size="icon" variant="secondary" disabled={!Object.keys(overrides).length} onClick={() => setOverrides({})} aria-label="Reset arrangement" title="Reset arrangement"><RotateCcw /></Button>

                {selectedSlots.length >= 2 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="secondary"><Settings2 />Align<ChevronDown /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>Horizontal</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => applyAlign(alignLeft)}>Align left</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => applyAlign(alignCenterX)}>Align center</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => applyAlign(alignRight)}>Align right</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Vertical</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => applyAlign(alignTop)}>Align top</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => applyAlign(alignMiddleY)}>Align middle</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => applyAlign(alignBottom)}>Align bottom</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}

                <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                <Button type="button" size="icon" variant="secondary" disabled={zoom <= CANVAS_ZOOM_MIN} onClick={() => setZoom((value) => clampCanvasZoom(value / 1.15))} aria-label="Zoom out" title="Zoom out"><Minus /></Button>
                <span className="min-w-12 text-center text-xs font-medium tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button type="button" size="icon" variant="secondary" disabled={zoom >= CANVAS_ZOOM_MAX} onClick={() => setZoom((value) => clampCanvasZoom(value * 1.15))} aria-label="Zoom in" title="Zoom in"><Plus /></Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setZoom(1)} title="Fit sheet"><Grid2X2 />Fit sheet</Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon" variant="ghost" className="ml-auto" aria-label="Canvas shortcuts" title="Shortcuts"><HelpCircle /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Canvas shortcuts</DropdownMenuLabel>
                    <DropdownMenuItem disabled>Shift-click · Select multiple</DropdownMenuItem>
                    <DropdownMenuItem disabled>Drag empty space · Box select</DropdownMenuItem>
                    <DropdownMenuItem disabled>Arrow keys · Move 1 mm</DropdownMenuItem>
                    <DropdownMenuItem disabled>Shift + arrows · Move 5 mm</DropdownMenuItem>
                    <DropdownMenuItem disabled>Space + drag · Pan canvas</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div
                ref={canvasPane}
                data-label-canvas
                tabIndex={manual ? 0 : undefined}
                className={cn(
                  "max-h-[calc(100vh-17rem)] min-h-[520px] overflow-auto bg-zinc-100/70 p-5 outline-none dark:bg-zinc-950/50",
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
                  className="relative mx-auto border border-zinc-300 bg-white shadow-[0_18px_55px_rgb(9_9_11/0.16)] transition-shadow duration-200"
                  style={{ width: displayLayout.sheetWidthPt * canvasScale, height: displayLayout.sheetHeightPt * canvasScale }}
                  onPointerDown={onCanvasPointerDown}
                >
                  <div
                    className="pointer-events-none absolute border border-dashed border-sky-400/70"
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
                  {dragOverlay ? <SmartGuideOverlay overlay={dragOverlay} scale={canvasScale} /> : null}
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
                            "absolute overflow-hidden border-2 border-zinc-300 bg-white transition-[outline,box-shadow] duration-150",
                            selected && "shadow-[0_0_0_3px_rgb(225_29_72/0.14)]",
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
                          <SheetSlotLabel orderId={placement.orderId} templateId={selectedId} rotation={placement.rotation} />
                          {selected ? (
                            <span className="pointer-events-none absolute left-1 top-1 z-10 rounded-md bg-brand px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                              {placement.orderId}
                            </span>
                          ) : null}
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

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-4 py-2.5 text-xs text-muted">
                <span>{displayLayout.columns} × {displayLayout.rows}{displayLayout.rotation ? ` · Rotated ${displayLayout.rotation}°` : ""}</span>
                <span aria-live="polite">{selectedSlots.length ? `${selectedSlots.length} selected` : manual ? "Click or drag to select labels" : "Turn on Select & move to edit"}</span>
              </div>
            </>
          ) : (
            <div className="flex min-h-[520px] flex-col items-center justify-center p-8 text-center">
              <Grid2X2 className="size-8 text-muted" />
              <p className="mt-3 text-sm font-semibold">
                {items.length ? "Adjust the layout to fit these labels" : "Choose labels to build your sheet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted">
                {items.length
                  ? "Open Arrange and Advanced layout, then reduce label size or choose a larger sheet."
                  : "Start in step 1. Your A4 preview will appear here automatically."}
              </p>
            </div>
          )}

          {previewUrl ? (
            <div className="border-t border-border">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-surface-soft"
                onClick={() => setShowPdfPreview((current) => !current)}
                aria-expanded={showPdfPreview}
              >
                <Eye className="size-4 text-muted" />
                Final PDF preview
                <ChevronDown className={cn("ml-auto size-4 text-muted transition-transform duration-200", showPdfPreview && "rotate-180")} />
              </button>
              {showPdfPreview ? (
                <div className="border-t border-border bg-surface-soft p-3">
                  <iframe title="Sheet PDF preview" src={previewUrl} className="h-[620px] w-full rounded-xl border border-border bg-white [color-scheme:light]" />
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-card/95 p-3 shadow-[0_-8px_30px_rgb(9_9_11/0.08)] backdrop-blur sm:hidden">
        <Button type="button" size="sm" variant="secondary" className="flex-1" onClick={preview} disabled={Boolean(busy) || !items.length || layout?.ok === false}><Eye />Preview</Button>
        <Button type="button" size="sm" variant="secondary" className="flex-1" onClick={download} disabled={Boolean(busy) || !items.length || layout?.ok === false}><Download />Download</Button>
        <Button type="button" size="sm" className="flex-1" onClick={print} disabled={Boolean(busy) || !canPrint}><Printer />Print</Button>
      </div>
    </div>
  );
}

const SheetSlotLabel = memo(function SheetSlotLabel({
  orderId,
  templateId,
  rotation,
}: {
  orderId: string;
  templateId: string;
  rotation: 0 | 90;
}) {
  const label = useQuery({
    queryKey: ["multi-print-label-raster", templateId, orderId],
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
      return response.arrayBuffer();
    },
  });
  const { url, error } = usePdfFirstPageUrl(label.data);

  if (!url) {
    return (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white px-2 text-center text-[11px] text-zinc-500">
        {label.isError ? label.error.message : error ?? ""}
      </span>
    );
  }

  if (rotation === 90) {
    return (
      <img
        alt=""
        src={url}
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none bg-white object-contain"
        style={{
          width: "100cqh",
          height: "100cqw",
          transform: "translate(-50%, -50%) rotate(-90deg)",
        }}
      />
    );
  }

  return (
    <img alt="" src={url} className="pointer-events-none absolute inset-0 h-full w-full bg-white object-contain" />
  );
});
