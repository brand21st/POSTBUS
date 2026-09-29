import { calculateMultiUpLayout, type MultiUpGaps, type MultiUpMargins, type MultiUpRotation } from "@/modules/labels/multi-up/layout";
import { multiPrintPaperName, pagePreset, sheetPreset, type MultiPrintPaperId } from "@/modules/labels/page-presets";

const a4 = sheetPreset("A4");

export const LABEL_4X6 = pagePreset("4x6");

export const A4_FOUR_UP = {
  id: "a4-4",
  name: "A4 — 4 Labels",
  paperSize: "A4" as const,
  columns: 2,
  rows: 2,
  rotation: 0 as MultiUpRotation,
  scale: 1,
  sheetWidthMm: a4.widthMm,
  sheetHeightMm: a4.heightMm,
};

const TARGET_GAP_MM = 2;

const zeroMargins: MultiUpMargins = { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 };
const zeroGaps: MultiUpGaps = { horizontalMm: 0, verticalMm: 0 };

export type GridSpacingInput = {
  sheetWidthMm: number;
  sheetHeightMm: number;
  columns: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
};

/** Splits leftover sheet space into equal gaps (capped) and equal opposite margins. Negative leftover is all zeros. */
export function gridSpacing(input: GridSpacingInput): { margins: MultiUpMargins; gaps: MultiUpGaps } {
  const leftoverW = input.sheetWidthMm - input.columns * input.labelWidthMm;
  const leftoverH = input.sheetHeightMm - input.rows * input.labelHeightMm;
  if (!(leftoverW >= 0) || !(leftoverH >= 0) || !(input.columns > 0) || !(input.rows > 0)) {
    return { margins: { ...zeroMargins }, gaps: { ...zeroGaps } };
  }
  const gapCountX = Math.max(0, input.columns - 1);
  const gapCountY = Math.max(0, input.rows - 1);
  const horizontalMm = gapCountX > 0 ? Math.min(TARGET_GAP_MM, leftoverW / gapCountX) : 0;
  const verticalMm = gapCountY > 0 ? Math.min(TARGET_GAP_MM, leftoverH / gapCountY) : 0;
  const side = (leftoverW - horizontalMm * gapCountX) / 2;
  const end = (leftoverH - verticalMm * gapCountY) / 2;
  return {
    margins: { topMm: end, rightMm: side, bottomMm: end, leftMm: side },
    gaps: { horizontalMm, verticalMm },
  };
}

export function a4FourUpSpacing(labelWidthMm: number, labelHeightMm: number) {
  return gridSpacing({
    sheetWidthMm: A4_FOUR_UP.sheetWidthMm,
    sheetHeightMm: A4_FOUR_UP.sheetHeightMm,
    columns: A4_FOUR_UP.columns,
    rows: A4_FOUR_UP.rows,
    labelWidthMm,
    labelHeightMm,
  });
}

export type FourBySixPreset = {
  id: string;
  name: string;
  quantity: number;
  columns: number;
  rows: number;
  rotation: 0;
  scale: number;
  labelWidthMm: number;
  labelHeightMm: number;
  margins: MultiUpMargins;
  gaps: MultiUpGaps;
};

/** Uniform scale (no stretch) so a cols×rows grid of labels fits on the sheet. */
export function uniformGridFitScale(
  sheetWidthMm: number,
  sheetHeightMm: number,
  columns: number,
  rows: number,
  labelWidthMm: number,
  labelHeightMm: number
) {
  if (!(columns > 0) || !(rows > 0) || !(labelWidthMm > 0) || !(labelHeightMm > 0)) return 0;
  const scale = Math.min(sheetWidthMm / (columns * labelWidthMm), sheetHeightMm / (rows * labelHeightMm));
  return scale > 0 ? Math.min(1, scale) : 0;
}

function layoutFits(
  sheetWidthMm: number,
  sheetHeightMm: number,
  columns: number | null,
  rows: number | null,
  margins: MultiUpMargins,
  gaps: MultiUpGaps,
  copies: number,
  labelWidthMm = LABEL_4X6.widthMm,
  labelHeightMm = LABEL_4X6.heightMm,
  scale = 1
) {
  return calculateMultiUpLayout({
    sheetWidthMm,
    sheetHeightMm,
    labelWidthMm,
    labelHeightMm,
    margins,
    gaps,
    rotation: 0,
    scale,
    columns,
    rows,
    items: [{ orderId: "probe", copies }],
  });
}

/** A4 2×2 of 4×6 labels, uniformly scaled down so all four fit. */
export function a4FourLabelPreset(sheetWidthMm: number, sheetHeightMm: number): FourBySixPreset | null {
  if (Math.abs(sheetWidthMm - A4_FOUR_UP.sheetWidthMm) > 1 || Math.abs(sheetHeightMm - A4_FOUR_UP.sheetHeightMm) > 1) {
    return null;
  }
  let scale = uniformGridFitScale(
    A4_FOUR_UP.sheetWidthMm,
    A4_FOUR_UP.sheetHeightMm,
    A4_FOUR_UP.columns,
    A4_FOUR_UP.rows,
    LABEL_4X6.widthMm,
    LABEL_4X6.heightMm
  );
  if (!(scale > 0)) return null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const spacing = gridSpacing({
      sheetWidthMm: A4_FOUR_UP.sheetWidthMm,
      sheetHeightMm: A4_FOUR_UP.sheetHeightMm,
      columns: A4_FOUR_UP.columns,
      rows: A4_FOUR_UP.rows,
      labelWidthMm: LABEL_4X6.widthMm * scale,
      labelHeightMm: LABEL_4X6.heightMm * scale,
    });
    const result = layoutFits(
      A4_FOUR_UP.sheetWidthMm,
      A4_FOUR_UP.sheetHeightMm,
      A4_FOUR_UP.columns,
      A4_FOUR_UP.rows,
      spacing.margins,
      spacing.gaps,
      4,
      LABEL_4X6.widthMm,
      LABEL_4X6.heightMm,
      scale
    );
    if (result.ok) {
      return {
        id: "A4-4-labels",
        name: "A4 · 4 Labels (2×2)",
        quantity: 4,
        columns: A4_FOUR_UP.columns,
        rows: A4_FOUR_UP.rows,
        rotation: 0,
        scale,
        labelWidthMm: LABEL_4X6.widthMm,
        labelHeightMm: LABEL_4X6.heightMm,
        margins: spacing.margins,
        gaps: spacing.gaps,
      };
    }
    scale *= 0.999;
  }
  return null;
}

export function generate4x6Presets(
  sheetWidthMm: number,
  sheetHeightMm: number,
  paper: MultiPrintPaperId | "custom" = "custom"
): FourBySixPreset[] {
  if (!(sheetWidthMm > 0) || !(sheetHeightMm > 0)) return [];
  const probe = layoutFits(sheetWidthMm, sheetHeightMm, null, null, zeroMargins, zeroGaps, 1);
  if (!probe.ok) return [];

  const paperName = multiPrintPaperName(paper);
  const byQuantity = new Map<number, FourBySixPreset>();
  for (let columns = 1; columns <= probe.columns; columns += 1) {
    for (let rows = 1; rows <= probe.rows; rows += 1) {
      const quantity = columns * rows;
      const spacing = gridSpacing({
        sheetWidthMm,
        sheetHeightMm,
        columns,
        rows,
        labelWidthMm: LABEL_4X6.widthMm,
        labelHeightMm: LABEL_4X6.heightMm,
      });
      const result = layoutFits(sheetWidthMm, sheetHeightMm, columns, rows, spacing.margins, spacing.gaps, quantity);
      if (!result.ok) continue;
      const existing = byQuantity.get(quantity);
      if (existing && !(columns > existing.columns || (columns === existing.columns && rows < existing.rows))) {
        continue;
      }
      byQuantity.set(quantity, {
        id: `${paper}-${quantity}`,
        name: `${paperName} · ${quantity} × 4×6`,
        quantity,
        columns,
        rows,
        rotation: 0,
        scale: 1,
        labelWidthMm: LABEL_4X6.widthMm,
        labelHeightMm: LABEL_4X6.heightMm,
        margins: spacing.margins,
        gaps: spacing.gaps,
      });
    }
  }
  const presets = [...byQuantity.values()];
  const fourUp = a4FourLabelPreset(sheetWidthMm, sheetHeightMm);
  if (fourUp && !presets.some((item) => item.quantity === 4)) presets.push(fourUp);
  return presets.sort((a, b) => a.quantity - b.quantity);
}
