import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { mmFromPt } from "@/modules/labels/layout/units";
import type {
  MultiUpCopy,
  MultiUpGaps,
  MultiUpMargins,
  MultiUpPlacementOverride,
  MultiUpRotation,
} from "@/modules/labels/multi-up/layout";
import { isSheetSizeId, sheetPreset, type SheetSizeId } from "@/modules/labels/page-presets";
import type { LabelTemplate } from "@/modules/labels/template-schema";

const MAX_LABELS = 100;

export type MultiUpDisposition = "inline" | "attachment" | "print";

export type MultiUpSheetRequest = {
  templateId: string | null;
  disposition: MultiUpDisposition;
  items: MultiUpCopy[];
  sheet: {
    paperSize: SheetSizeId | "custom";
    widthMm: number;
    heightMm: number;
    margins: MultiUpMargins;
    gaps: MultiUpGaps;
    rotation: MultiUpRotation | "auto";
    scale: number;
    columns: number | null;
    rows: number | null;
    placements: MultiUpPlacementOverride[];
  };
};

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function margins(value: unknown): MultiUpMargins {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    topMm: numberValue(source.topMm, 0),
    rightMm: numberValue(source.rightMm, 0),
    bottomMm: numberValue(source.bottomMm, 0),
    leftMm: numberValue(source.leftMm, 0),
  };
}

function gaps(value: unknown): MultiUpGaps {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    horizontalMm: numberValue(source.horizontalMm, 0),
    verticalMm: numberValue(source.verticalMm, 0),
  };
}

function rotation(value: unknown): MultiUpRotation | "auto" {
  if (value === 0 || value === "0") return 0;
  if (value === 90 || value === "90") return 90;
  return "auto";
}

function optionalCount(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Math.floor(numberValue(value, Number.NaN));
  return Number.isFinite(parsed) ? parsed : null;
}

function placements(value: unknown): MultiUpPlacementOverride[] {
  if (!Array.isArray(value)) return [];
  const boxes: MultiUpPlacementOverride[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!row) continue;
    const index = Math.floor(numberValue(row.index, Number.NaN));
    const xPt = numberValue(row.xPt, Number.NaN);
    const yPt = numberValue(row.yPt, Number.NaN);
    const widthPt = numberValue(row.widthPt, Number.NaN);
    const heightPt = numberValue(row.heightPt, Number.NaN);
    if (!Number.isInteger(index) || index < 0) continue;
    if (![xPt, yPt, widthPt, heightPt].every((point) => Number.isFinite(point))) continue;
    if (!(widthPt > 0) || !(heightPt > 0)) continue;
    boxes.push({ index, xPt, yPt, widthPt, heightPt });
  }
  return boxes;
}

export function labelSizeMm(page: LabelTemplate["page"]) {
  return {
    widthMm: page.widthMm ?? mmFromPt(page.widthPt),
    heightMm: page.heightMm ?? mmFromPt(page.heightPt),
  };
}

export function parseMultiUpRequest(body: unknown): MultiUpSheetRequest {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sheet = source.sheet && typeof source.sheet === "object" ? (source.sheet as Record<string, unknown>) : {};
  const paper = String(sheet.paperSize ?? "");
  if (paper !== "custom" && !isSheetSizeId(paper)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Sheet size must be A4, A3, A5, or custom.");
  }
  const paperSize: SheetSizeId | "custom" = paper === "custom" ? "custom" : paper;
  const preset = paperSize === "custom" ? null : sheetPreset(paperSize);
  const items = Array.isArray(source.items) ? source.items : [];
  const copies = items
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        orderId: String(row.orderId ?? "").trim(),
        copies: Math.max(0, Math.floor(numberValue(row.copies, 1))),
      };
    })
    .filter((item) => item.orderId && item.copies > 0);
  const total = copies.reduce((sum, item) => sum + item.copies, 0);
  if (!copies.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Add at least one order.");
  if (total > MAX_LABELS) throw new AppError(ERROR_CODES.VALIDATION_ERROR, `A sheet run can include up to ${MAX_LABELS} labels.`);
  const disposition = source.disposition === "attachment" || source.disposition === "print" ? source.disposition : "inline";
  const scale = numberValue(sheet.scale, 1);
  return {
    templateId: source.templateId ? String(source.templateId) : null,
    disposition,
    items: copies,
    sheet: {
      paperSize,
      widthMm: preset ? preset.widthMm : numberValue(sheet.widthMm, 0),
      heightMm: preset ? preset.heightMm : numberValue(sheet.heightMm, 0),
      margins: margins(sheet.margins),
      gaps: gaps(sheet.gaps),
      rotation: rotation(sheet.rotation),
      scale,
      columns: optionalCount(sheet.columns),
      rows: optionalCount(sheet.rows),
      placements: placements(sheet.placements),
    },
  };
}
