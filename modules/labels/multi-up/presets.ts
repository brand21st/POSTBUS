import type { MultiUpGaps, MultiUpMargins, MultiUpRotation } from "@/modules/labels/multi-up/layout";
import { sheetPreset } from "@/modules/labels/page-presets";

const a4 = sheetPreset("A4");

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

/** Splits leftover A4 space into one 2×2 gap and equal opposite margins. Negative leftover is all zeros. */
export function a4FourUpSpacing(labelWidthMm: number, labelHeightMm: number): {
  margins: MultiUpMargins;
  gaps: MultiUpGaps;
} {
  const leftoverW = A4_FOUR_UP.sheetWidthMm - 2 * labelWidthMm;
  const leftoverH = A4_FOUR_UP.sheetHeightMm - 2 * labelHeightMm;
  if (!(leftoverW >= 0) || !(leftoverH >= 0)) {
    return {
      margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
      gaps: { horizontalMm: 0, verticalMm: 0 },
    };
  }
  const horizontalMm = Math.min(TARGET_GAP_MM, leftoverW);
  const verticalMm = Math.min(TARGET_GAP_MM, leftoverH);
  const side = (leftoverW - horizontalMm) / 2;
  const end = (leftoverH - verticalMm) / 2;
  return {
    margins: { topMm: end, rightMm: side, bottomMm: end, leftMm: side },
    gaps: { horizontalMm, verticalMm },
  };
}
