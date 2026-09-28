"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { LabelLayoutPaint } from "@/components/labels/label-layout-paint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import { ADDRESS_FIELD_OPTIONS, normalizeAddressLayout, type AddressFieldConfig, type AddressLayout } from "@/modules/labels/address-layout";
import {
  CUSTOM_TEXT_LIMIT,
  PRODUCT_COLUMNS,
  createCustomTextElement,
  customTextIds,
  customTextLabel,
  editorLabelBlocks,
  isCodPayment,
  isCustomTextId,
  nextCustomTextId,
  productColumnVisible,
  type CustomLabelPreview,
} from "@/modules/labels/custom-blocks";
import { clampRect, SAFE_MARGIN_PT, snapToGuides, type GuideLine } from "@/modules/labels/collision";
import { packingForEditor } from "@/modules/labels/layout/editor-data";
import { layoutLabel, WATERMARK_ID } from "@/modules/labels/layout/layout";
import { mmFromPt, ptFromMm, storedFromTopLeft, topLeftFromStored } from "@/modules/labels/layout/units";
import { validateLabel } from "@/modules/labels/layout/validate";
import { PAGE_PRESETS, isPaperSizeId, pagePreset, sizeChoiceForPage } from "@/modules/labels/page-presets";
import {
  applyPaperSize,
  elementBoxFromMm,
  elementBoxMm,
  fitLabelBorderToPage,
  fullPageBorderRect,
  normalizeHLines,
  withEditorDraft,
  type LabelTemplate,
  type NamedLabelTemplate,
  type TemplateElement,
} from "@/modules/labels/template-schema";

type TemplateResponse = { template: LabelTemplate; logoUrl?: string | null };
type PreviewResponse = { preview: CustomLabelPreview };

const CANVAS_ZOOM_MIN = 0.25;
const CANVAS_ZOOM_MAX = 4;

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

function entryFor(template: LabelTemplate, templateId: string): NamedLabelTemplate {
  const found = template.library?.find((item) => item.id === templateId);
  if (found) return found;
  return {
    id: templateId,
    name: "Current template",
    isDefault: true,
    page: template.page,
    elements: template.elements,
  };
}

function PropertyNumber({
  label,
  value,
  min,
  max,
  step = 1,
  onValue,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValue: (value: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-muted">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onValue(next);
        }}
      />
    </label>
  );
}

const STATIC_TEXT_BLOCKS = new Set(["promotionalMessage", "returnPolicy", "customerSupport"]);

function usesAutoHeight(id: string) {
  return id === "fromAddress" || id === "shipTo" || id === "products" || id === "codAmount" || isCustomTextId(id);
}

function StyleToggle({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border text-sm font-semibold",
        pressed ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground"
      )}
      onClick={onToggle}
    >
      {label === "Bold" ? "B" : "I"}
    </button>
  );
}

function BlockProperties({
  id,
  label,
  element,
  page,
  onChange,
  onRemove,
  storeLogoUrl,
  warnings = [],
}: {
  id: string;
  label: string;
  element: TemplateElement;
  page: LabelTemplate["page"];
  onChange: (patch: Partial<TemplateElement>) => void;
  onRemove?: () => void;
  storeLogoUrl?: string | null;
  warnings?: string[];
}) {
  const box = elementBoxMm(element, page.heightPt);
  const rounded = (value: number) => Math.round(value * 10) / 10;
  const setMm = (patch: { xMm?: number; yMm?: number; widthMm?: number; heightMm?: number }) => {
    const next = elementBoxFromMm(element, page, patch);
    const autoBox = usesAutoHeight(id);
    const shorter = autoBox && patch.heightMm != null && next.height + 0.5 < element.height;
    onChange(shorter ? { ...next, autoHeight: false } : next);
  };
  const positionOnly = id === "labelBorder";
  const logo = id === "merchantLogo";
  const barcode = id === "indiaPostBarcode";
  const shipTo = id === "shipTo";
  const fromAddress = id === "fromAddress";
  const addressBlock = shipTo || fromAddress;
  const showType = !positionOnly && !logo && !addressBlock;
  const showSpacing = showType && !barcode;
  const layout = normalizeAddressLayout(
    element.addressLayout,
    fromAddress ? "From/ Return Address" : "Ship To:"
  );
  const patchLayout = (next: AddressLayout) => onChange({ addressLayout: next });
  const moveField = (index: number, direction: -1 | 1) => {
    const fields = [...layout.fields];
    const swap = index + direction;
    if (swap < 0 || swap >= fields.length) return;
    const current = fields[index];
    const other = fields[swap];
    if (!current || !other) return;
    fields[index] = other;
    fields[swap] = current;
    patchLayout({ ...layout, fields });
  };
  const patchField = (index: number, patch: Partial<AddressFieldConfig>) => {
    patchLayout({
      ...layout,
      fields: layout.fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    });
  };

  return (
    <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto text-sm">
      <p className="font-medium">{label}</p>
      {warnings.length ? (
        <ul className="space-y-1 text-xs text-amber-700">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {fromAddress || shipTo || id === "products" || id === "codAmount" || isCustomTextId(id) ? (
        <label className="flex items-center gap-2">
          <Checkbox
            checked={element.autoHeight !== false}
            onCheckedChange={(checked) => onChange({ autoHeight: checked === true })}
          />
          Auto height
        </label>
      ) : null}
      {addressBlock ? (
        <>
          <PropertyNumber label="X (mm)" min={0} step={0.1} value={rounded(box.xMm)} onValue={(xMm) => setMm({ xMm })} />
          <PropertyNumber label="Y (mm)" min={0} step={0.1} value={rounded(box.yMm)} onValue={(yMm) => setMm({ yMm })} />
          <PropertyNumber label="Width (mm)" min={1} step={0.1} value={rounded(box.widthMm)} onValue={(widthMm) => setMm({ widthMm })} />
          <PropertyNumber label="Height (mm)" min={1} step={0.1} value={rounded(box.heightMm)} onValue={(heightMm) => setMm({ heightMm })} />
          <PropertyNumber
            label="Font size"
            min={6}
            max={36}
            value={element.fontSize ?? 11}
            onValue={(fontSize) => onChange({ fontSize })}
          />
          <label className="flex items-center gap-2">
            <Checkbox
              checked={layout.showHeading}
              onCheckedChange={(checked) => patchLayout({ ...layout, showHeading: checked === true })}
            />
            Show heading
          </label>
          <label className="block space-y-1">
            <span className="text-muted">Heading text</span>
            <Input value={layout.headingText} onChange={(event) => patchLayout({ ...layout, headingText: event.target.value })} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={layout.headingBold}
                onCheckedChange={(checked) => patchLayout({ ...layout, headingBold: checked === true })}
              />
              Bold heading
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={layout.headingItalic}
                onCheckedChange={(checked) => patchLayout({ ...layout, headingItalic: checked === true })}
              />
              Italic heading
            </label>
          </div>
          <PropertyNumber
            label="Line gap (mm)"
            min={0}
            max={20}
            step={0.1}
            value={layout.lineGapMm}
            onValue={(lineGapMm) => patchLayout({ ...layout, lineGapMm })}
          />
          <label className="block space-y-1">
            <span className="text-muted">Same-line separator</span>
            <Input
              value={layout.sameLineSeparator}
              onChange={(event) => patchLayout({ ...layout, sameLineSeparator: event.target.value })}
            />
          </label>
          {layout.fields.map((field, index) => (
            <div key={field.id} className="rounded-xl border border-border p-2">
              <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <Checkbox
                  checked={field.visible}
                  onCheckedChange={(checked) => patchField(index, { visible: checked === true })}
                />
                <span className="font-medium">{ADDRESS_FIELD_OPTIONS.find((item) => item.id === field.id)?.label ?? field.id}</span>
              </label>
                <button type="button" aria-label={`Move ${field.id} up`} className="rounded-lg border border-border px-2 py-1" onClick={() => moveField(index, -1)}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${field.id} down`} className="rounded-lg border border-border px-2 py-1" onClick={() => moveField(index, 1)}>
                  ↓
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-muted">
                <Checkbox
                  checked={field.sameLineAsNext}
                  onCheckedChange={(checked) => patchField(index, { sameLineAsNext: checked === true })}
                />
                Same line as next
              </label>
              <div className="mt-2 flex gap-1">
                <StyleToggle label="Bold" pressed={Boolean(field.bold)} onToggle={() => patchField(index, { bold: !field.bold })} />
                <StyleToggle label="Italic" pressed={Boolean(field.italic)} onToggle={() => patchField(index, { italic: !field.italic })} />
              </div>
            </div>
          ))}
        </>
      ) : null}
      {id === "products"
        ? PRODUCT_COLUMNS.map((column) => (
            <label key={column.id} className="flex items-center gap-2">
              <Checkbox
                checked={productColumnVisible(element, column)}
                onCheckedChange={(checked) => onChange({ [column.flag]: checked === true })}
              />
              {column.label}
            </label>
          ))
        : null}
      {barcode ? (
        <label className="flex items-center gap-2">
          <Checkbox
            checked={element.showArticleText !== false}
            onCheckedChange={(checked) => onChange({ showArticleText: checked === true })}
          />
          Show article number
        </label>
      ) : null}
      {STATIC_TEXT_BLOCKS.has(id) || isCustomTextId(id) ? (
        <label className="block space-y-1">
          <span className="text-muted">Text</span>
          <textarea
            className="min-h-24 w-full rounded-xl border border-border bg-card px-3 py-2"
            value={element.content ?? ""}
            onChange={(event) => onChange({ content: event.target.value })}
            placeholder="Type the text that prints on the label"
          />
        </label>
      ) : null}
      {isCustomTextId(id) && id !== "customText" && onRemove ? (
        <Button type="button" variant="secondary" className="w-full" onClick={onRemove}>
          Remove text block
        </Button>
      ) : null}
      {showType ? (
        <>
          <label className="block space-y-1">
            <span className="text-muted">Alignment</span>
            <select
              className="h-10 w-full rounded-xl border border-border bg-card px-3"
              value={element.align ?? (barcode ? "center" : "left")}
              onChange={(event) => onChange({ align: event.target.value as TemplateElement["align"] })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <PropertyNumber
            label="Font size"
            min={6}
            max={36}
            value={element.fontSize ?? (barcode ? 11 : 10)}
            onValue={(fontSize) => onChange({ fontSize })}
          />
          <label className="flex items-center gap-2">
            <Checkbox
              checked={element.fontWeight === "bold"}
              onCheckedChange={(checked) => onChange({ fontWeight: checked === true ? "bold" : "normal" })}
            />
            Bold
          </label>
        </>
      ) : null}
      {showSpacing ? (
        <>
          <PropertyNumber
            label="Line space"
            min={0}
            max={24}
            value={element.lineGap ?? 2}
            onValue={(lineGap) => onChange({ lineGap })}
          />
          <PropertyNumber label="Gap" min={0} max={40} value={element.gap ?? 0} onValue={(gap) => onChange({ gap })} />
        </>
      ) : null}
      {positionOnly ? (
        <>
          <Button type="button" variant="secondary" className="w-full" onClick={() => onChange(fullPageBorderRect(page))}>
            Full border
          </Button>
          <PropertyNumber
            label="Thickness"
            min={0.5}
            max={8}
            step={0.5}
            value={element.borderWidth ?? 1}
            onValue={(borderWidth) => onChange({ borderWidth })}
          />
          <PropertyNumber
            label="Line gap (mm)"
            min={0}
            max={40}
            step={0.1}
            value={element.hLineGapMm ?? 0}
            onValue={(hLineGapMm) => onChange({ hLineGapMm })}
          />
          <PropertyNumber
            label="Line thickness"
            min={0.25}
            max={8}
            step={0.25}
            value={element.hLineWidth ?? element.borderWidth ?? 1}
            onValue={(hLineWidth) => onChange({ hLineWidth })}
          />
          {normalizeHLines(element.hLines, page.heightPt).map((line, index, lines) => (
            <div key={`hline-${index}`} className="rounded-xl border border-border p-2">
              <label className="flex items-center gap-2 font-medium">
                <Checkbox
                  checked={line.visible}
                  onCheckedChange={(checked) =>
                    onChange({
                      hLines: lines.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, visible: checked === true } : item
                      ),
                    })
                  }
                />
                Line {index + 1}
              </label>
              <PropertyNumber
                label="Y (mm)"
                min={0}
                step={0.1}
                value={rounded(line.yMm)}
                onValue={(yMm) =>
                  onChange({
                    hLines: lines.map((item, itemIndex) => (itemIndex === index ? { ...item, yMm } : item)),
                  })
                }
              />
            </div>
          ))}
          <p className="text-xs text-muted">The border outlines the full page. Each line can be shown or hidden.</p>
        </>
      ) : null}
      {logo ? (
        <>
          {storeLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Organization logo" src={storeLogoUrl} className="h-16 w-16 rounded-lg border border-border object-contain" />
          ) : null}
          <p className="text-xs text-muted">This block prints the logo from Settings → Organization.</p>
          <PropertyNumber label="Gap" min={0} max={40} value={element.gap ?? 0} onValue={(gap) => onChange({ gap })} />
        </>
      ) : null}
      {positionOnly || addressBlock ? null : (
        <>
          <PropertyNumber label="Width mm" min={1} step={0.1} value={rounded(box.widthMm)} onValue={(widthMm) => setMm({ widthMm })} />
          <PropertyNumber label="Height mm" min={1} step={0.1} value={rounded(box.heightMm)} onValue={(heightMm) => setMm({ heightMm })} />
          <PropertyNumber label="X mm" min={0} step={0.1} value={rounded(box.xMm)} onValue={(xMm) => setMm({ xMm })} />
          <PropertyNumber label="Y mm" min={0} step={0.1} value={rounded(box.yMm)} onValue={(yMm) => setMm({ yMm })} />
        </>
      )}
      {barcode ? (
        <p className="text-xs text-muted">This block prints only the barcode and the India Post article number.</p>
      ) : null}
    </div>
  );
}

export function CustomLabelEditor({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ["label-template"],
    queryFn: () => api<TemplateResponse>("/api/v1/label-template"),
  });
  const [name, setName] = useState("");
  const [page, setPage] = useState<LabelTemplate["page"] | null>(null);
  const [elements, setElements] = useState<LabelTemplate["elements"] | null>(null);
  const [selected, setSelected] = useState<string>("indiaPostBarcode");
  const [orderId, setOrderId] = useState("");
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [paymentPreview, setPaymentPreview] = useState<"COD" | "PREPAID">("PREPAID");
  const [preview, setPreview] = useState<CustomLabelPreview | null>(null);
  const [zoom, setZoom] = useState(1);
  const [logoPx, setLogoPx] = useState<{ width: number; height: number } | null>(null);
  const [barcodePx, setBarcodePx] = useState<{ width: number; height: number } | null>(null);
  const canvasPane = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const spaceHeldRef = useRef(false);
  const pan = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: TemplateElement;
  } | null>(null);

  useEffect(() => {
    const template = templates.data?.template;
    if (!template || page) return;
    const entry = entryFor(template, templateId);
    setName(entry.name);
    setPage(entry.page);
    setElements(fitLabelBorderToPage(entry.elements, entry.page));
  }, [templates.data, templateId, page]);

  useEffect(() => {
    const pane = canvasPane.current;
    if (!pane || !page) return;
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
  }, [page, elements]);

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
      if (pan.current) {
        pan.current = null;
        setPanning(false);
      }
      setGuides([]);
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

  const save = useMutation({
    mutationFn: (template: LabelTemplate) =>
      api<TemplateResponse>("/api/v1/label-template", {
        method: "PUT",
        body: JSON.stringify({ template }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["label-template"] });
      toast.success("Template saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loadOrder = useMutation({
    mutationFn: (value: string) =>
      api<PreviewResponse>(`/api/v1/label-template/custom-data?orderId=${encodeURIComponent(value)}`),
    onSuccess: (result) => {
      setPreview(result.preview);
      setShipmentId(result.preview.shipmentId);
      if (result.preview.paymentMode) {
        setPaymentPreview(isCodPayment(result.preview.paymentMode) ? "COD" : "PREPAID");
      }
      toast.success(result.preview.articleId ? "Shipment loaded." : "Shipment loaded without an India Post article number.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const storeLogoUrl = preview?.logoUrl || templates.data?.logoUrl || null;
  const barcodeUrl = preview?.articleId && shipmentId ? `/api/v1/label-template/barcode?shipmentId=${encodeURIComponent(shipmentId)}` : null;
  const layout = useMemo(() => {
    if (!page || !elements) return null;
    return layoutLabel({ templateVersion: Math.max(templates.data?.template.templateVersion ?? 5, 5), page, elements }, packingForEditor(preview, paymentPreview), {
      logo: storeLogoUrl ? logoPx : null,
      barcode: barcodeUrl ? barcodePx : null,
    });
  }, [page, elements, preview, paymentPreview, logoPx, barcodePx, storeLogoUrl, barcodeUrl, templates.data?.template.templateVersion]);
  const layoutWarnings = useMemo(() => (layout ? validateLabel(layout) : []), [layout]);

  useEffect(() => {
    if (!storeLogoUrl) return;
    const image = new Image();
    image.onload = () => setLogoPx({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = storeLogoUrl;
  }, [storeLogoUrl]);

  useEffect(() => {
    if (!barcodeUrl) return;
    const image = new Image();
    image.onload = () => setBarcodePx({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = barcodeUrl;
  }, [barcodeUrl]);

  const draftTemplate = () => {
    const template = templates.data?.template;
    if (!template || !elements || !page) return null;
    return withEditorDraft(template, templateId, { name, page, elements });
  };

  if (!page || !elements) {
    return <p className="p-6 text-sm text-muted">Loading template…</p>;
  }

  const widthPt = page.widthPt;
  const heightPt = page.heightPt;
  const fitScale = Math.min(1.1, 760 / widthPt);
  const scale = fitScale * zoom;
  const sizeChoice = page.paperSize === "custom" ? "custom" : sizeChoiceForPage(page);
  const selectedElement = elements[selected];

  const updateElement = (id: string, patch: Partial<TemplateElement>) => {
    setElements((current) => {
      if (!current?.[id]) return current;
      return { ...current, [id]: { ...current[id], ...patch } };
    });
  };

  const startPan = (event: React.PointerEvent<HTMLElement>) => {
    const pane = canvasPane.current;
    if (!pane) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
    pan.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: pane.scrollLeft,
      scrollTop: pane.scrollTop,
    };
    setPanning(true);
  };

  const onBlockPointerDown = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (spaceHeldRef.current || event.button === 1) {
      startPan(event);
      return;
    }
    const element = elements[id];
    if (!element) return;
    event.stopPropagation();
    setSelected(id);
    drag.current = { id, mode: "move", startX: event.clientX, startY: event.clientY, origin: element };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The move still tracks the pointer when capture is unavailable.
    }
  };

  const onResizeStart = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (spaceHeldRef.current || event.button === 1) {
      startPan(event);
      return;
    }
    const element = elements[id];
    if (!element) return;
    event.stopPropagation();
    const placed = layout?.blocks.find((block) => block.id === id);
    const origin = placed
      ? { ...element, ...storedFromTopLeft(heightPt, { x: placed.x, y: placed.y, width: placed.width, height: placed.height }) }
      : element;
    drag.current = { id, mode: "resize", startX: event.clientX, startY: event.clientY, origin };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Resize still follows the pointer when capture is unavailable.
    }
  };

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (spaceHeldRef.current || event.button === 1) {
      startPan(event);
      return;
    }
    if (event.currentTarget === event.target) setSelected("");
  };

  const onPointerMove = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (pan.current || spaceHeldRef.current) return;
    const active = drag.current;
    if (!active || active.id !== id || !elements[id]) return;
    const dx = (event.clientX - active.startX) / scale;
    const dy = (event.clientY - active.startY) / scale;
    const originTop = topLeftFromStored(heightPt, active.origin);
    const nextTop =
      active.mode === "resize"
        ? { ...originTop, width: originTop.width + dx, height: originTop.height + dy }
        : { ...originTop, x: originTop.x + dx, y: originTop.y + dy };
    const others = (layout?.blocks ?? [])
      .filter((block) => block.id !== id && block.id !== "labelBorder" && block.id !== WATERMARK_ID)
      .map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height }));
    const guided =
      id === "labelBorder" || id === WATERMARK_ID
        ? { rect: nextTop, guides: [] as GuideLine[] }
        : snapToGuides(nextTop, others, widthPt, heightPt, { resize: active.mode === "resize" });
    setGuides(guided.guides);
    const next = clampRect(storedFromTopLeft(heightPt, guided.rect), widthPt, heightPt);
    const autoBox = usesAutoHeight(id);
    const shorter = active.mode === "resize" && next.height + 0.5 < active.origin.height;
    updateElement(id, autoBox && shorter ? { ...elements[id], ...next, autoHeight: false } : next);
  };

  const persist = () => {
    const next = draftTemplate();
    if (next) save.mutate(next);
  };

  const openPdf = async (path: "custom-preview" | "custom-download" | "custom-print") => {
    const lookupOrder = preview?.orderNumber || orderId.trim();
    if (path !== "custom-preview" && !preview?.shipmentId && !lookupOrder && !shipmentId) {
      toast.error("Load an order before previewing the label.");
      return;
    }
    const draft = draftTemplate();
    const body = {
      shipmentId: preview?.shipmentId ?? (lookupOrder ? undefined : shipmentId),
      orderId: preview?.shipmentId ? undefined : lookupOrder || undefined,
      templateId: templateId === "active" ? undefined : templateId,
      paymentPreview,
      template: draft,
    };
    if (path === "custom-print") {
      const printed = await api<{ connected?: boolean; downloadPath?: string; message?: string }>(
        "/api/v1/label-template/custom-print",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      if (!printed.connected && printed.downloadPath) {
        window.open(printed.downloadPath, "_blank", "noopener,noreferrer");
      }
      toast.success(printed.message || "Shipping label sent to the printer.");
      return;
    }
    const response = await fetch(`/api/v1/label-template/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("application/pdf")) {
      let message = "Could not render the shipping label.";
      try {
        const payload = (await response.json()) as { message?: string };
        message = payload.message || message;
      } catch {
        // keep default
      }
      toast.error(message);
      return;
    }
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), "postbus-custom-label-pdf", "noopener,noreferrer");
  };

  const groups = ["Layout", "Header", "Content"] as const;
  const labelBlocks = editorLabelBlocks(elements);

  const addCustomText = () => {
    const id = nextCustomTextId(elements);
    if (!id) {
      toast.error(`You can add up to ${CUSTOM_TEXT_LIMIT} text blocks.`);
      return;
    }
    const index = customTextIds(elements).length;
    setElements({ ...elements, [id]: createCustomTextElement(page, index) });
    setSelected(id);
  };

  const removeCustomText = (id: string) => {
    if (!isCustomTextId(id) || id === "customText") return;
    setElements((current) => {
      if (!current?.[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelected("");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Label template"
        description="The India Post barcode is its own block. Drag it, resize it, then save."
        actions={
          <Link href="/dashboard/labels/templates">
            <Button type="button" variant="secondary">
              All templates
            </Button>
          </Link>
        }
      />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Template name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="w-56 space-y-1 text-sm">
          <span className="text-muted">Size</span>
          <Select
            value={sizeChoice}
            onValueChange={(value) => {
              if (value === "custom") {
                const widthMm = page.widthMm ?? mmFromPt(page.widthPt);
                const heightMm = page.heightMm ?? mmFromPt(page.heightPt);
                const nextPage = {
                  ...page,
                  paperSize: "custom" as const,
                  widthMm,
                  heightMm,
                };
                setPage(nextPage);
                setElements(fitLabelBorderToPage(elements, nextPage));
                return;
              }
              if (!isPaperSizeId(value)) return;
              const next = applyPaperSize(
                { templateVersion: Math.max(templates.data?.template.templateVersion ?? 5, 5), page, elements },
                value
              );
              const preset = pagePreset(value);
              setPage({ ...next.page, widthMm: preset.widthMm, heightMm: preset.heightMm });
              setElements(next.elements);
            }}
          >
            <SelectTrigger aria-label="Size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom size</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {sizeChoice === "custom" ? (
          <>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Width mm</span>
              <Input
                type="number"
                min={50}
                value={Math.round(page.widthMm ?? mmFromPt(page.widthPt))}
                onChange={(event) => {
                  const widthMm = Number(event.target.value);
                  if (!Number.isFinite(widthMm) || widthMm < 50) return;
                  const nextPage = { ...page, paperSize: "custom" as const, widthMm, widthPt: ptFromMm(widthMm) };
                  setPage(nextPage);
                  setElements(fitLabelBorderToPage(elements, nextPage));
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted">Height mm</span>
              <Input
                type="number"
                min={50}
                value={Math.round(page.heightMm ?? mmFromPt(page.heightPt))}
                onChange={(event) => {
                  const heightMm = Number(event.target.value);
                  if (!Number.isFinite(heightMm) || heightMm < 50) return;
                  const nextPage = { ...page, paperSize: "custom" as const, heightMm, heightPt: ptFromMm(heightMm) };
                  setPage(nextPage);
                  setElements(fitLabelBorderToPage(elements, nextPage));
                }}
              />
            </label>
          </>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="text-muted">Preview with order ID</span>
          <Input value={orderId} onChange={(event) => setOrderId(event.target.value)} placeholder="Order ID" />
        </label>
        <Button type="button" variant="secondary" onClick={() => orderId.trim() && loadOrder.mutate(orderId.trim())}>
          Load order
        </Button>
        <div className="flex gap-1">
          {(["PREPAID", "COD"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={paymentPreview === mode ? "primary" : "secondary"}
              onClick={() => setPaymentPreview(mode)}
            >
              {mode === "COD" ? "COD" : "Prepaid"}
            </Button>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={() => void openPdf("custom-preview")}>
          Preview PDF
        </Button>
        <Button type="button" variant="secondary" onClick={() => void openPdf("custom-download")}>
          Download
        </Button>
        <Button type="button" variant="secondary" onClick={() => void openPdf("custom-print")}>
          Print
        </Button>
        <Button type="button" onClick={persist} disabled={save.isPending}>
          Save
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_260px]">
        <aside className="rounded-2xl border border-border bg-card p-3">
          <h2 className="px-2 text-sm font-semibold">Label blocks</h2>
          {groups.map((group) => (
            <div key={group} className="mt-3">
              <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted">{group}</p>
              <ul className="mt-1 space-y-1">
                {labelBlocks.filter((block) => block.group === group).map((block) => {
                  const element = elements[block.id];
                  return (
                    <li key={block.id}>
                      <div
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm",
                          selected === block.id ? "bg-rose-50 text-brand-dark" : "hover:bg-surface-soft"
                        )}
                      >
                        <Checkbox
                          checked={Boolean(element?.visible)}
                          onCheckedChange={(checked) => updateElement(block.id, { visible: checked === true })}
                          aria-label={`${block.label} visibility`}
                        />
                        <button type="button" className="flex-1 cursor-pointer text-left" onClick={() => setSelected(block.id)}>
                          {block.label}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {group === "Content" ? (
                <Button type="button" variant="secondary" className="mt-2 w-full" onClick={addCustomText}>
                  Add text block
                </Button>
              ) : null}
            </div>
          ))}
        </aside>
        <div className="flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-soft">
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-card px-3 py-2">
            <Button
              type="button"
              variant="secondary"
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
              aria-label="Zoom in"
              disabled={zoom >= CANVAS_ZOOM_MAX}
              onClick={() => setZoom((value) => clampCanvasZoom(value * 1.15))}
            >
              +
            </Button>
            <Button type="button" variant="secondary" onClick={() => setZoom(1)}>
              Fit
            </Button>
            <span className="text-xs text-muted">Space+drag to move · Scroll to zoom</span>
          </div>
          <div
            ref={canvasPane}
            data-label-canvas
            className={cn(
              "min-h-0 flex-1 overflow-auto p-4",
              (spaceHeld || panning) && "select-none",
              spaceHeld && !panning && "cursor-grab",
              panning && "cursor-grabbing"
            )}
            onPointerDown={onCanvasPointerDown}
            onAuxClick={(event) => event.preventDefault()}
          >
          <div
            className="relative mx-auto bg-white shadow-sm"
            style={{ width: widthPt * scale, height: heightPt * scale }}
            onPointerDown={onCanvasPointerDown}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute border border-dashed border-red-700/50"
              style={{
                left: SAFE_MARGIN_PT * scale,
                top: SAFE_MARGIN_PT * scale,
                right: SAFE_MARGIN_PT * scale,
                bottom: SAFE_MARGIN_PT * scale,
                boxShadow: `0 0 0 ${SAFE_MARGIN_PT * scale}px rgba(185, 28, 28, 0.08)`,
              }}
            />
            {guides.map((guide, index) => {
              const start = Math.min(guide.from, guide.to) * scale;
              const span = Math.abs(guide.to - guide.from) * scale;
              const vertical = guide.axis === "x";
              return (
                <div
                  key={`${guide.kind}-${guide.axis}-${guide.at}-${index}`}
                  aria-hidden
                  className="pointer-events-none absolute border-dashed border-sky-600"
                  style={{
                    left: vertical ? guide.at * scale : start,
                    top: vertical ? start : guide.at * scale,
                    width: vertical ? 0 : span,
                    height: vertical ? span : 0,
                    borderLeftWidth: vertical ? 1 : 0,
                    borderTopWidth: vertical ? 0 : 1,
                  }}
                />
              );
            })}
            {layout ? (
              <LabelLayoutPaint
                layout={layout}
                scale={scale}
                selected={selected}
                spaceHeld={spaceHeld}
                panning={panning}
                logoUrl={storeLogoUrl}
                barcodeUrl={barcodeUrl}
                onPointerDown={onBlockPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => {
                  drag.current = null;
                  setGuides([]);
                }}
                onResizeStart={onResizeStart}
              />
            ) : null}

          </div>
          </div>
        </div>
        <aside className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Properties</h2>
          {selectedElement ? (
            <BlockProperties
              id={selected}
              label={labelBlocks.find((block) => block.id === selected)?.label ?? customTextLabel(selected)}
              element={selectedElement}
              page={page}
              onChange={(patch) => updateElement(selected, patch)}
              storeLogoUrl={storeLogoUrl}
              onRemove={selected !== "customText" && isCustomTextId(selected) ? () => removeCustomText(selected) : undefined}
              warnings={layoutWarnings.filter((warning) => warning.ids.includes(selected)).map((warning) => warning.message)}
            />
          ) : (
            <p className="mt-4 text-sm text-muted">Select a block to edit it. Drag to move, and drag the corner to resize.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
