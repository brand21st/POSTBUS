"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { LabelLayoutPaint } from "@/components/labels/label-layout-paint";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Maximize2,
  MousePointerClick,
  Plus,
  Printer,
  Save,
  Scan,
  Search,
  Trash2,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { beginClientPrint, endClientPrint } from "@/lib/print/client-guard";
import { pdfFilenameFromDisposition, presentPdfFile } from "@/lib/print/download-pdf";
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
import {
  MIN_CUSTOM_PAGE_MM,
  PAGE_PRESETS,
  committedPageMm,
  isPaperSizeId,
  pagePreset,
  sizeChoiceForPage,
} from "@/modules/labels/page-presets";
import {
  applyPaperSize,
  elementBoxFromMm,
  elementBoxMm,
  fitLabelBorderToPage,
  fitTemplateToCustomPage,
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

/** Arrow keys inside these widgets belong to the widget, not the canvas. */
function ownsArrowKeys(target: EventTarget | null) {
  if (isTypingTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("[role='listbox'], [role='menu'], [role='dialog'], [role='slider'], [role='radiogroup']"));
}

type PdfPath = "custom-preview" | "custom-download" | "custom-print";

const NUDGE_KEYS: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

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
  unit,
  onValue,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onValue: (value: number) => void;
}) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="relative block">
        <Input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          className={cn("h-9 tabular-nums", unit && "pr-9")}
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onValue(next);
          }}
        />
        {unit ? (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
            {unit}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function PropertySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span>{children}</span>
    </label>
  );
}

/**
 * Validation messages name blocks by raw id ("shipTo and orderIdDate overlap").
 * The Properties panel already names the selected block, so drop it and name the
 * other block the way the block list does.
 */
function describeWarning(warning: { ids: string[]; message: string }, selected: string, labelOf: (id: string) => string) {
  const [a, b] = warning.ids;
  let text = warning.message;
  if (a && b) {
    const other = a === selected ? b : a;
    text = text.replace(`${a} and ${b} overlap`, `Overlaps ${labelOf(other)}`);
  } else if (text.startsWith(`${selected} `)) {
    text = text.slice(selected.length + 1);
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
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
      title={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        label === "Bold" ? "font-bold" : "italic",
        pressed ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground hover:bg-surface-soft"
      )}
      onClick={onToggle}
    >
      {label === "Bold" ? "B" : "I"}
    </button>
  );
}

const ALIGN_OPTIONS = [
  { value: "left", label: "Align left", Icon: AlignLeft },
  { value: "center", label: "Align center", Icon: AlignCenter },
  { value: "right", label: "Align right", Icon: AlignRight },
] as const;

function AlignControl({
  value,
  onValue,
}: {
  value: NonNullable<TemplateElement["align"]>;
  onValue: (value: NonNullable<TemplateElement["align"]>) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted">Alignment</span>
      <div role="group" aria-label="Alignment" className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {ALIGN_OPTIONS.map(({ value: option, label, Icon }) => (
          <button
            key={option}
            type="button"
            aria-label={label}
            aria-pressed={value === option}
            title={label}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              value === option ? "bg-brand text-white" : "text-foreground hover:bg-surface-soft"
            )}
            onClick={() => onValue(option)}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

function BlockProperties({
  id,
  element,
  page,
  onChange,
  onRemove,
  storeLogoUrl,
  warnings = [],
}: {
  id: string;
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
  const textBlock = STATIC_TEXT_BLOCKS.has(id) || isCustomTextId(id);
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
    <div className="space-y-4 text-sm">
      {warnings.length ? (
        <div
          role="status"
          className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <ul className="space-y-1">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {positionOnly ? null : (
        <PropertySection title="Position & size">
          <div className="grid grid-cols-2 gap-2">
            <PropertyNumber label="X" unit="mm" min={0} step={0.1} value={rounded(box.xMm)} onValue={(xMm) => setMm({ xMm })} />
            <PropertyNumber label="Y" unit="mm" min={0} step={0.1} value={rounded(box.yMm)} onValue={(yMm) => setMm({ yMm })} />
            <PropertyNumber label="Width" unit="mm" min={1} step={0.1} value={rounded(box.widthMm)} onValue={(widthMm) => setMm({ widthMm })} />
            <PropertyNumber label="Height" unit="mm" min={1} step={0.1} value={rounded(box.heightMm)} onValue={(heightMm) => setMm({ heightMm })} />
          </div>
          {usesAutoHeight(id) ? (
            <CheckRow checked={element.autoHeight !== false} onChange={(autoHeight) => onChange({ autoHeight })}>
              Auto height <span className="text-xs text-muted">· grows with content</span>
            </CheckRow>
          ) : null}
        </PropertySection>
      )}

      {textBlock ? (
        <PropertySection title="Text">
          <label className="block">
            <span className="sr-only">Text</span>
            <textarea
              className="min-h-24 w-full rounded-xl border border-border bg-card px-3 py-2 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              value={element.content ?? ""}
              onChange={(event) => onChange({ content: event.target.value })}
              placeholder="Type the text that prints on the label"
            />
          </label>
        </PropertySection>
      ) : null}

      {addressBlock ? (
        <>
          <PropertySection title="Heading">
            <CheckRow checked={layout.showHeading} onChange={(showHeading) => patchLayout({ ...layout, showHeading })}>
              Show heading
            </CheckRow>
            {layout.showHeading ? (
              <div className="flex items-end gap-1.5">
                <label className="block min-w-0 flex-1 space-y-1">
                  <span className="text-xs text-muted">Heading text</span>
                  <Input className="h-9" value={layout.headingText} onChange={(event) => patchLayout({ ...layout, headingText: event.target.value })} />
                </label>
                <StyleToggle label="Bold" pressed={layout.headingBold} onToggle={() => patchLayout({ ...layout, headingBold: !layout.headingBold })} />
                <StyleToggle label="Italic" pressed={layout.headingItalic} onToggle={() => patchLayout({ ...layout, headingItalic: !layout.headingItalic })} />
              </div>
            ) : null}
          </PropertySection>
          <PropertySection title="Text style">
            <div className="grid grid-cols-2 gap-2">
              <PropertyNumber label="Font size" unit="pt" min={6} max={36} value={element.fontSize ?? 11} onValue={(fontSize) => onChange({ fontSize })} />
              <PropertyNumber
                label="Line gap"
                unit="mm"
                min={0}
                max={20}
                step={0.1}
                value={layout.lineGapMm}
                onValue={(lineGapMm) => patchLayout({ ...layout, lineGapMm })}
              />
            </div>
            <label className="block space-y-1">
              <span className="text-xs text-muted">Same-line separator</span>
              <Input
                className="h-9"
                value={layout.sameLineSeparator}
                onChange={(event) => patchLayout({ ...layout, sameLineSeparator: event.target.value })}
              />
            </label>
          </PropertySection>
          <PropertySection title="Address lines">
            <ol className="space-y-1.5">
              {layout.fields.map((field, index) => {
                const fieldLabel = ADDRESS_FIELD_OPTIONS.find((item) => item.id === field.id)?.label ?? field.id;
                return (
                  <li key={field.id} className={cn("rounded-xl border border-border p-2", !field.visible && "bg-surface-soft")}>
                    <div className="flex items-center gap-1">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={field.visible}
                          onCheckedChange={(checked) => patchField(index, { visible: checked === true })}
                        />
                        <span className={cn("truncate font-medium", !field.visible && "text-muted")}>{fieldLabel}</span>
                      </label>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${fieldLabel} up`}
                        disabled={index === 0}
                        onClick={() => moveField(index, -1)}
                      >
                        <ChevronUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${fieldLabel} down`}
                        disabled={index === layout.fields.length - 1}
                        onClick={() => moveField(index, 1)}
                      >
                        <ChevronDown aria-hidden />
                      </Button>
                    </div>
                    {field.visible ? (
                      <div className="mt-1.5 flex items-center justify-between gap-2 pl-6">
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                          <Checkbox
                            checked={field.sameLineAsNext}
                            onCheckedChange={(checked) => patchField(index, { sameLineAsNext: checked === true })}
                          />
                          Same line as next
                        </label>
                        <div className="flex gap-1">
                          <StyleToggle label="Bold" pressed={Boolean(field.bold)} onToggle={() => patchField(index, { bold: !field.bold })} />
                          <StyleToggle label="Italic" pressed={Boolean(field.italic)} onToggle={() => patchField(index, { italic: !field.italic })} />
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </PropertySection>
        </>
      ) : null}

      {id === "products" ? (
        <PropertySection title="Columns">
          {PRODUCT_COLUMNS.map((column) => (
            <CheckRow key={column.id} checked={productColumnVisible(element, column)} onChange={(checked) => onChange({ [column.flag]: checked })}>
              {column.label}
            </CheckRow>
          ))}
        </PropertySection>
      ) : null}

      {showType ? (
        <PropertySection title="Text style">
          <AlignControl value={element.align ?? (barcode ? "center" : "left")} onValue={(align) => onChange({ align })} />
          <div className="grid grid-cols-2 items-end gap-2">
            <PropertyNumber
              label="Font size"
              unit="pt"
              min={6}
              max={36}
              value={element.fontSize ?? (barcode ? 11 : 10)}
              onValue={(fontSize) => onChange({ fontSize })}
            />
            <div className="pb-0.5">
              <CheckRow checked={element.fontWeight === "bold"} onChange={(bold) => onChange({ fontWeight: bold ? "bold" : "normal" })}>
                Bold
              </CheckRow>
            </div>
          </div>
          {showSpacing ? (
            <div className="grid grid-cols-2 gap-2">
              <PropertyNumber label="Line space" unit="pt" min={0} max={24} value={element.lineGap ?? 2} onValue={(lineGap) => onChange({ lineGap })} />
              <PropertyNumber label="Gap" unit="pt" min={0} max={40} value={element.gap ?? 0} onValue={(gap) => onChange({ gap })} />
            </div>
          ) : null}
          {barcode ? (
            <CheckRow checked={element.showArticleText !== false} onChange={(showArticleText) => onChange({ showArticleText })}>
              Show article number
            </CheckRow>
          ) : null}
        </PropertySection>
      ) : null}

      {positionOnly ? (
        <>
          <PropertySection title="Border">
            <Button type="button" variant="secondary" size="sm" className="w-full" onClick={() => onChange(fullPageBorderRect(page))}>
              <Maximize2 aria-hidden />
              Fit border to page
            </Button>
            <PropertyNumber
              label="Thickness"
              unit="pt"
              min={0.5}
              max={8}
              step={0.5}
              value={element.borderWidth ?? 1}
              onValue={(borderWidth) => onChange({ borderWidth })}
            />
          </PropertySection>
          <PropertySection title="Divider lines">
            <div className="grid grid-cols-2 gap-2">
              <PropertyNumber
                label="Line gap"
                unit="mm"
                min={0}
                max={40}
                step={0.1}
                value={element.hLineGapMm ?? 0}
                onValue={(hLineGapMm) => onChange({ hLineGapMm })}
              />
              <PropertyNumber
                label="Thickness"
                unit="pt"
                min={0.25}
                max={8}
                step={0.25}
                value={element.hLineWidth ?? element.borderWidth ?? 1}
                onValue={(hLineWidth) => onChange({ hLineWidth })}
              />
            </div>
            <ul className="space-y-1.5">
              {normalizeHLines(element.hLines, page.heightPt).map((line, index, lines) => (
                <li key={`hline-${index}`} className="flex items-end gap-2 rounded-xl border border-border p-2">
                  <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-2 font-medium">
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
                  <div className="w-24">
                    <PropertyNumber
                      label="Y"
                      unit="mm"
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
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">The border outlines the full page. Each line can be shown or hidden.</p>
          </PropertySection>
        </>
      ) : null}

      {logo ? (
        <PropertySection title="Logo">
          {storeLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Organization logo" src={storeLogoUrl} className="h-16 w-16 rounded-lg border border-border object-contain" />
          ) : null}
          <p className="text-xs text-muted">This block prints the logo from Settings → Organization.</p>
          <PropertyNumber label="Gap" unit="pt" min={0} max={40} value={element.gap ?? 0} onValue={(gap) => onChange({ gap })} />
        </PropertySection>
      ) : null}

      {barcode ? (
        <p className="text-xs text-muted">This block prints only the barcode and the India Post article number.</p>
      ) : null}

      {isCustomTextId(id) && id !== "customText" && onRemove ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full text-error hover:border-error/40 hover:text-error"
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
          Remove text block
        </Button>
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
  const [customWidthDraft, setCustomWidthDraft] = useState("");
  const [customHeightDraft, setCustomHeightDraft] = useState("");
  const [preview, setPreview] = useState<CustomLabelPreview | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<PdfPath | null>(null);
  const [zoom, setZoom] = useState(1);
  const [logoPx, setLogoPx] = useState<{ width: number; height: number } | null>(null);
  const [barcodePx, setBarcodePx] = useState<{ width: number; height: number } | null>(null);
  const canvasPane = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  useEffect(() => {
    zoomRef.current = zoom;
  });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [edgeLock, setEdgeLock] = useState(false);
  const spaceHeldRef = useRef(false);
  const pan = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: TemplateElement;
  } | null>(null);

  const template = templates.data?.template;
  if (template && !page) {
    const entry = entryFor(template, templateId);
    const fitted = fitLabelBorderToPage(entry.elements, entry.page);
    setName(entry.name);
    setPage(entry.page);
    setElements(fitted);
    setSavedSnapshot(JSON.stringify({ name: entry.name, page: entry.page, elements: fitted }));
  }

  const snapshot = useMemo(
    () => (page && elements ? JSON.stringify({ name, page, elements }) : null),
    [name, page, elements]
  );
  const dirty = snapshot !== null && savedSnapshot !== null && snapshot !== savedSnapshot;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Keyboard shortcuts read the latest render's state through this ref.
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      setEdgeLock(false);
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

  useEffect(() => {
    shortcutRef.current = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const next = draftTemplate();
        if (!next || save.isPending) return;
        const savedState = snapshot;
        save.mutate(next, { onSuccess: () => setSavedSnapshot(savedState) });
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || !page) return;
      if (event.key === "Escape" && !isTypingTarget(event.target)) {
        setSelected("");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !isTypingTarget(event.target)) {
        if (!isCustomTextId(selected) || selected === "customText") return;
        event.preventDefault();
        const id = selected;
        setElements((current) => {
          if (!current?.[id]) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
        setSelected("");
        return;
      }
      const delta = NUDGE_KEYS[event.key];
      if (!delta || !selected || selected === "labelBorder" || selected === WATERMARK_ID) return;
      if (ownsArrowKeys(event.target)) return;
      event.preventDefault();
      const step = ptFromMm(event.shiftKey ? 5 : 0.5);
      const id = selected;
      setElements((current) => {
        const element = current?.[id];
        if (!current || !element) return current;
        const top = topLeftFromStored(page.heightPt, element);
        const moved = storedFromTopLeft(page.heightPt, {
          ...top,
          x: top.x + delta[0] * step,
          y: top.y + delta[1] * step,
        });
        return { ...current, [id]: { ...element, ...clampRect({ ...element, ...moved }, page.widthPt, page.heightPt) } };
      });
    };
  });

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
      const merged = { ...current[id], ...patch };
      if (id === "labelBorder") return { ...current, [id]: merged };
      return { ...current, [id]: { ...merged, ...clampRect(merged, widthPt, heightPt) } };
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
    const wanted = storedFromTopLeft(heightPt, nextTop);
    setEdgeLock(
      Math.abs(wanted.x - next.x) > 0.4 ||
        Math.abs(wanted.y - next.y) > 0.4 ||
        Math.abs(wanted.width - next.width) > 0.4 ||
        Math.abs(wanted.height - next.height) > 0.4
    );
    const autoBox = usesAutoHeight(id);
    const shorter = active.mode === "resize" && next.height + 0.5 < active.origin.height;
    updateElement(id, autoBox && shorter ? { ...elements[id], ...next, autoHeight: false } : next);
  };

  const persist = () => {
    const next = draftTemplate();
    if (!next || save.isPending) return;
    const savedState = snapshot;
    save.mutate(next, { onSuccess: () => setSavedSnapshot(savedState) });
  };

  const openPdf = async (path: PdfPath) => {
    if (pdfBusy) return;
    setPdfBusy(path);
    try {
      await renderPdf(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not render the shipping label.");
    } finally {
      setPdfBusy(null);
    }
  };

  const renderPdf = async (path: PdfPath) => {
    const lookupOrder = preview?.orderNumber || orderId.trim();
    if (path === "custom-print" && !preview?.shipmentId && !lookupOrder && !shipmentId) {
      toast.error("Load an order before printing the label.");
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
      const key = beginClientPrint("custom-label-print");
      if (!key) return;
      try {
        const printed = await api<{ connected?: boolean; downloadPath?: string; message?: string }>(
          "/api/v1/label-template/custom-print",
          {
            method: "POST",
            headers: { "Idempotency-Key": key },
            body: JSON.stringify(body),
          }
        );
        if (!printed.connected && printed.downloadPath) {
          window.open(printed.downloadPath, "_blank", "noopener,noreferrer");
        }
        toast.success(printed.message || "Queued for the Print Agent.");
      } finally {
        endClientPrint("custom-label-print");
      }
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
    const filename = pdfFilenameFromDisposition(
      response.headers.get("Content-Disposition"),
      path === "custom-download" ? "shipping-label.pdf" : "shipping-label-preview.pdf"
    );
    presentPdfFile(blob, filename, path === "custom-download" ? "download" : "preview");
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

  const warnedIds = new Map<string, number>();
  for (const warning of layoutWarnings) {
    for (const id of warning.ids) warnedIds.set(id, (warnedIds.get(id) ?? 0) + 1);
  }
  const firstWarnedId = layoutWarnings[0]?.ids[0];
  const blockLabel = (id: string) =>
    labelBlocks.find((block) => block.id === id)?.label ??
    (id === WATERMARK_ID ? "Watermark" : isCustomTextId(id) ? customTextLabel(id) : id);
  const selectedLabel = selected ? blockLabel(selected) : "";
  const loadedOrder = preview?.orderNumber || null;
  const submitOrder = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = orderId.trim();
    if (!value) {
      toast.error("Enter an order ID to preview real shipment data.");
      return;
    }
    loadOrder.mutate(value);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="truncate">{name.trim() || "Untitled template"}</span>
            <span
              role="status"
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
                save.isPending
                  ? "bg-surface-soft text-muted"
                  : dirty
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              )}
            >
              {save.isPending ? (
                <LoaderCircle aria-hidden className="size-3 animate-spin" />
              ) : dirty ? (
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
              ) : (
                <Check aria-hidden className="size-3" />
              )}
              {save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
            </span>
          </span>
        }
        description="Drag blocks on the label, fine-tune them in Properties, then save."
        actions={
          <>
            <Link
              href="/dashboard/labels/templates"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={(event) => {
                if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) event.preventDefault();
              }}
            >
              <ArrowLeft aria-hidden />
              All templates
            </Link>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <Button type="button" variant="secondary" size="sm" disabled={pdfBusy !== null} onClick={() => void openPdf("custom-preview")}>
              {pdfBusy === "custom-preview" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Eye aria-hidden />}
              Preview PDF
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={pdfBusy !== null} onClick={() => void openPdf("custom-download")}>
              {pdfBusy === "custom-download" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
              Download
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pdfBusy !== null}
              title={loadedOrder ? undefined : "Load an order first to print a real label"}
              onClick={() => void openPdf("custom-print")}
            >
              {pdfBusy === "custom-print" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Printer aria-hidden />}
              Print
            </Button>
            <Button type="button" size="sm" onClick={persist} disabled={save.isPending} title="Save (Ctrl+S)">
              {save.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      <div className="grid gap-x-6 gap-y-4 rounded-2xl border border-border bg-card p-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted">Template</legend>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 space-y-1 text-sm">
              <span className="text-xs text-muted">Name</span>
              <Input className="h-10" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. 4×6 thermal label" />
            </label>
            <label className="w-48 space-y-1 text-sm">
              <span className="text-xs text-muted">Paper size</span>
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
                    setCustomWidthDraft(String(Math.round(widthMm)));
                    setCustomHeightDraft(String(Math.round(heightMm)));
                    setPage(nextPage);
                    setElements(fitTemplateToCustomPage(elements, nextPage, page));
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
              <div className="flex items-end gap-1.5">
                <label className="w-24 space-y-1 text-sm">
                  <span className="text-xs text-muted">Width mm</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    className="h-10 tabular-nums"
                    min={MIN_CUSTOM_PAGE_MM}
                    value={customWidthDraft || String(Math.round(page.widthMm ?? mmFromPt(page.widthPt)))}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setCustomWidthDraft(raw);
                      const widthMm = committedPageMm(raw);
                      if (widthMm == null) return;
                      const nextPage = { ...page, paperSize: "custom" as const, widthMm, widthPt: ptFromMm(widthMm) };
                      setPage(nextPage);
                      setElements(fitTemplateToCustomPage(elements, nextPage, page));
                    }}
                    onBlur={() => {
                      setCustomWidthDraft(String(Math.round(page.widthMm ?? mmFromPt(page.widthPt))));
                    }}
                  />
                </label>
                <span aria-hidden className="pb-2.5 text-sm text-muted">×</span>
                <label className="w-24 space-y-1 text-sm">
                  <span className="text-xs text-muted">Height mm</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    className="h-10 tabular-nums"
                    min={MIN_CUSTOM_PAGE_MM}
                    value={customHeightDraft || String(Math.round(page.heightMm ?? mmFromPt(page.heightPt)))}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setCustomHeightDraft(raw);
                      const heightMm = committedPageMm(raw);
                      if (heightMm == null) return;
                      const nextPage = { ...page, paperSize: "custom" as const, heightMm, heightPt: ptFromMm(heightMm) };
                      setPage(nextPage);
                      setElements(fitTemplateToCustomPage(elements, nextPage, page));
                    }}
                    onBlur={() => {
                      setCustomHeightDraft(String(Math.round(page.heightMm ?? mmFromPt(page.heightPt))));
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </fieldset>

        <span aria-hidden className="hidden w-px self-stretch bg-border xl:block" />

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted">Preview data</legend>
          <div className="flex flex-wrap items-end gap-3">
            <form className="flex min-w-56 flex-1 items-end gap-1.5" onSubmit={submitOrder}>
              <label className="min-w-0 flex-1 space-y-1 text-sm">
                <span className="text-xs text-muted">Order ID</span>
                <Input
                  className="h-10"
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                  placeholder="Paste an order ID"
                  enterKeyHint="go"
                />
              </label>
              <Button type="submit" variant="secondary" className="h-10" disabled={loadOrder.isPending}>
                {loadOrder.isPending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Search aria-hidden />}
                {loadOrder.isPending ? "Loading…" : "Load"}
              </Button>
            </form>
            <div className="space-y-1">
              <span className="block text-xs text-muted">Payment</span>
              <div role="group" aria-label="Payment preview" className="inline-flex h-10 rounded-[var(--radius-btn)] border border-border bg-surface-soft p-0.5">
                {(["PREPAID", "COD"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={paymentPreview === mode}
                    className={cn(
                      "rounded-[calc(var(--radius-btn)-2px)] px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      paymentPreview === mode ? "bg-card text-foreground shadow-sm" : "text-muted hover:text-foreground"
                    )}
                    onClick={() => setPaymentPreview(mode)}
                  >
                    {mode === "COD" ? "COD" : "Prepaid"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="flex min-h-5 items-center gap-1.5 text-xs text-muted">
            {loadedOrder ? (
              <>
                <span>
                  Showing order <span className="font-medium text-foreground">{loadedOrder}</span>
                  {preview?.articleId ? <> · Article {preview.articleId}</> : <> · no article number yet</>}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label="Clear loaded order"
                  onClick={() => {
                    setPreview(null);
                    setShipmentId(null);
                  }}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </>
            ) : (
              "Using sample data. Load an order to see a real address and barcode."
            )}
          </p>
        </fieldset>
      </div>

      <div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)_288px]">
        <aside
          aria-label="Label blocks"
          className="flex flex-col rounded-2xl border border-border bg-card lg:h-[calc(100dvh-14rem)] lg:min-h-[480px]"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Blocks</h2>
            <p className="text-xs text-muted">Tick to show on the label.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {groups.map((group) => (
              <div key={group} className="mt-2 first:mt-0">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group}</p>
                <ul className="space-y-0.5">
                  {labelBlocks.filter((block) => block.group === group).map((block) => {
                    const element = elements[block.id];
                    const visible = Boolean(element?.visible);
                    const issues = warnedIds.get(block.id) ?? 0;
                    const active = selected === block.id;
                    return (
                      <li key={block.id}>
                        <div
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors",
                            active ? "bg-brand/10 text-brand-dark ring-1 ring-brand/30 dark:text-brand" : "hover:bg-surface-soft"
                          )}
                        >
                          <Checkbox
                            checked={visible}
                            onCheckedChange={(checked) => updateElement(block.id, { visible: checked === true })}
                            aria-label={`${block.label} visibility`}
                          />
                          <button
                            type="button"
                            aria-current={active ? "true" : undefined}
                            className={cn(
                              "flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                              !visible && "text-muted"
                            )}
                            onClick={() => setSelected(block.id)}
                          >
                            <span className="truncate">{block.label}</span>
                            {!visible ? <EyeOff aria-label="Hidden" className="size-3.5 shrink-0 opacity-70" /> : null}
                          </button>
                          {issues ? (
                            <TriangleAlert
                              aria-label={`${issues} layout ${issues === 1 ? "issue" : "issues"}`}
                              className="size-3.5 shrink-0 text-amber-600"
                            />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {group === "Content" ? (
                  <Button type="button" variant="ghost" size="sm" className="mt-1 w-full justify-start text-brand" onClick={addCustomText}>
                    <Plus aria-hidden />
                    Add text block
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-soft lg:h-[calc(100dvh-14rem)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
            <div role="group" aria-label="Zoom" className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={zoom <= CANVAS_ZOOM_MIN}
                onClick={() => setZoom((value) => clampCanvasZoom(value / 1.15))}
              >
                <ZoomOut aria-hidden />
              </Button>
              <span aria-live="polite" className="min-w-12 text-center text-xs font-medium tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={zoom >= CANVAS_ZOOM_MAX}
                onClick={() => setZoom((value) => clampCanvasZoom(value * 1.15))}
              >
                <ZoomIn aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="xs" title="Fit label to view" onClick={() => setZoom(1)}>
                <Scan aria-hidden />
                Fit
              </Button>
            </div>
            <span className="text-xs tabular-nums text-muted">
              {Math.round(page.widthMm ?? mmFromPt(widthPt))} × {Math.round(page.heightMm ?? mmFromPt(heightPt))} mm
            </span>
            <div className="ml-auto flex items-center gap-2">
              {edgeLock ? <span className="text-xs font-medium text-brand">Stays inside the label</span> : null}
              {layoutWarnings.length ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:bg-amber-950/60 dark:text-amber-200"
                  onClick={() => firstWarnedId && setSelected(firstWarnedId)}
                >
                  <TriangleAlert aria-hidden className="size-3.5" />
                  {layoutWarnings.length} layout {layoutWarnings.length === 1 ? "issue" : "issues"}
                </button>
              ) : null}
              <span className="hidden text-xs text-muted 2xl:inline">
                Arrows nudge · Shift = 5 mm · Space+drag pans · Scroll zooms
              </span>
            </div>
          </div>
          <div
            ref={canvasPane}
            data-label-canvas
            className={cn(
              "min-h-0 flex-1 overflow-auto p-6",
              (spaceHeld || panning) && "select-none",
              spaceHeld && !panning && "cursor-grab",
              panning && "cursor-grabbing"
            )}
            onPointerDown={onCanvasPointerDown}
            onAuxClick={(event) => event.preventDefault()}
          >
          <div
            className={cn("relative mx-auto overflow-hidden bg-white shadow-md ring-1 ring-black/5", edgeLock && "ring-2 ring-brand")}
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
                  setEdgeLock(false);
                }}
                onResizeStart={onResizeStart}
              />
            ) : null}

          </div>
          </div>
        </div>

        <aside
          aria-label="Properties"
          className="flex flex-col rounded-2xl border border-border bg-card lg:h-[calc(100dvh-14rem)] lg:min-h-[480px]"
        >
          <div className="flex items-start gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Properties</h2>
              <p className="truncate text-xs text-muted">{selectedElement ? selectedLabel : "Nothing selected"}</p>
            </div>
            {selectedElement ? (
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Deselect block" title="Deselect (Esc)" onClick={() => setSelected("")}>
                <X aria-hidden />
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedElement ? (
              <BlockProperties
                key={selected}
                id={selected}
                element={selectedElement}
                page={page}
                onChange={(patch) => updateElement(selected, patch)}
                storeLogoUrl={storeLogoUrl}
                onRemove={selected !== "customText" && isCustomTextId(selected) ? () => removeCustomText(selected) : undefined}
                warnings={layoutWarnings
                  .filter((warning) => warning.ids.includes(selected))
                  .map((warning) => describeWarning(warning, selected, blockLabel))}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-surface-soft text-muted">
                  <MousePointerClick aria-hidden className="size-5" />
                </span>
                <p className="text-sm font-medium">Select a block</p>
                <p className="text-xs text-muted">Click a block on the label or in the list. Drag to move, drag the corner to resize.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
