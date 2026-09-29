import { mmFromPt, ptFromMm } from "@/modules/labels/layout/units";

export const PAPER_SIZE_IDS = ["A6", "4x6", "A5", "A4"] as const;

export type PaperSizeId = (typeof PAPER_SIZE_IDS)[number];

export type PagePreset = {
  id: PaperSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
};

export const PAGE_PRESETS: PagePreset[] = [
  { id: "A6", label: "A6 (105 × 148 mm)", widthMm: 105, heightMm: 148, widthPt: ptFromMm(105), heightPt: ptFromMm(148) },
  { id: "4x6", label: "4 × 6 in (102 × 152 mm)", widthMm: 102, heightMm: 152, widthPt: ptFromMm(102), heightPt: ptFromMm(152) },
  { id: "A5", label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210, widthPt: ptFromMm(148), heightPt: ptFromMm(210) },
  { id: "A4", label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297, widthPt: ptFromMm(210), heightPt: ptFromMm(297) },
];

export const SHEET_SIZE_IDS = ["A4", "A3", "A5"] as const;

export type SheetSizeId = (typeof SHEET_SIZE_IDS)[number];

export type SheetPreset = {
  id: SheetSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
};

const a4Preset = PAGE_PRESETS.find((item) => item.id === "A4");
const a5Preset = PAGE_PRESETS.find((item) => item.id === "A5");
if (!a4Preset || !a5Preset) throw new Error("A4 and A5 label presets are required for sheet sizes.");

export const SHEET_PRESETS: SheetPreset[] = [
  { ...a4Preset, id: "A4" },
  { id: "A3", label: "A3 (297 × 420 mm)", widthMm: 297, heightMm: 420, widthPt: ptFromMm(297), heightPt: ptFromMm(420) },
  { ...a5Preset, id: "A5" },
];

export function isPaperSizeId(value: string | null | undefined): value is PaperSizeId {
  return PAPER_SIZE_IDS.includes(value as PaperSizeId);
}

export function isSheetSizeId(value: string | null | undefined): value is SheetSizeId {
  return SHEET_SIZE_IDS.includes(value as SheetSizeId);
}

/** Label sizes plus A3, which is a sheet size stored on print jobs and station settings. */
export function isPrintPaperSize(value: string | null | undefined): value is PaperSizeId | "A3" {
  return isPaperSizeId(value) || value === "A3";
}

export type MultiPrintPaperId = PaperSizeId | "A3";

export type MultiPrintPaperOption = {
  id: MultiPrintPaperId;
  label: string;
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
};

/** Named Multi-Print sheets: sheet presets first, then unique label paper sizes. */
export const MULTI_PRINT_PAPERS: MultiPrintPaperOption[] = (() => {
  const seen = new Set<string>();
  const papers: MultiPrintPaperOption[] = [];
  for (const item of [...SHEET_PRESETS, ...PAGE_PRESETS]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    papers.push({
      id: item.id as MultiPrintPaperId,
      label: item.label,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      widthPt: item.widthPt,
      heightPt: item.heightPt,
    });
  }
  return papers;
})();

export function isMultiPrintPaperId(value: string | null | undefined): value is MultiPrintPaperId {
  return MULTI_PRINT_PAPERS.some((item) => item.id === value);
}

export function multiPrintPaper(id: MultiPrintPaperId): MultiPrintPaperOption {
  const preset = MULTI_PRINT_PAPERS.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown multi-print paper ${id}.`);
  return preset;
}

export function multiPrintPaperOptions() {
  return MULTI_PRINT_PAPERS;
}

export function multiPrintPaperName(id: MultiPrintPaperId | "custom") {
  if (id === "custom") return "Custom";
  if (id === "4x6") return "4×6";
  return id;
}

export function sheetPreset(id: SheetSizeId): SheetPreset {
  const preset = SHEET_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown sheet size ${id}.`);
  return preset;
}

export type SizeChoice = PaperSizeId | "custom";

export function sizeChoiceForPage(page: {
  widthPt: number;
  heightPt: number;
  widthMm?: number;
  heightMm?: number;
}): SizeChoice {
  const widthMm = page.widthMm ?? mmFromPt(page.widthPt);
  const heightMm = page.heightMm ?? mmFromPt(page.heightPt);
  const match = PAGE_PRESETS.find(
    (preset) => Math.abs(preset.widthMm - widthMm) < 1 && Math.abs(preset.heightMm - heightMm) < 1
  );
  return match?.id ?? "custom";
}

export function pagePreset(id: string | null | undefined): PagePreset {
  return PAGE_PRESETS.find((item) => item.id === id) ?? PAGE_PRESETS[0];
}

export function officialDrawRect(
  pageWidthPt: number,
  pageHeightPt: number,
  officialWidthPt = pagePreset("A6").widthPt,
  officialHeightPt = pagePreset("A6").heightPt
) {
  const fit = Math.min(1, pageWidthPt / officialWidthPt, pageHeightPt / officialHeightPt);
  const width = officialWidthPt * fit;
  const height = officialHeightPt * fit;
  return {
    x: (pageWidthPt - width) / 2,
    y: pageHeightPt - height,
    width,
    height,
  };
}

export function agentPaperSize(id: string | null | undefined): PaperSizeId | "A3" {
  if (id === "A3") return "A3";
  const preset = pagePreset(id);
  return preset.id === "4x6" ? "4x6" : preset.id;
}

export function printMediaForPage(page: {
  widthPt: number;
  heightPt: number;
  widthMm?: number;
  heightMm?: number;
}) {
  const widthMm = page.widthMm ?? mmFromPt(page.widthPt);
  const heightMm = page.heightMm ?? mmFromPt(page.heightPt);
  const portrait = PAGE_PRESETS.find(
    (preset) => Math.abs(preset.widthMm - widthMm) < 1 && Math.abs(preset.heightMm - heightMm) < 1
  );
  if (portrait) return { paperSize: portrait.id, orientation: "portrait" as const };
  const landscape = PAGE_PRESETS.find(
    (preset) => Math.abs(preset.widthMm - heightMm) < 1 && Math.abs(preset.heightMm - widthMm) < 1
  );
  if (landscape) return { paperSize: landscape.id, orientation: "landscape" as const };
  const sheetPortrait = SHEET_PRESETS.find(
    (preset) => Math.abs(preset.widthMm - widthMm) < 1 && Math.abs(preset.heightMm - heightMm) < 1
  );
  if (sheetPortrait) return { paperSize: sheetPortrait.id, orientation: "portrait" as const };
  const sheetLandscape = SHEET_PRESETS.find(
    (preset) => Math.abs(preset.widthMm - heightMm) < 1 && Math.abs(preset.heightMm - widthMm) < 1
  );
  if (sheetLandscape) return { paperSize: sheetLandscape.id, orientation: "landscape" as const };

  let best = PAGE_PRESETS[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const preset of PAGE_PRESETS) {
    const score = Math.min(
      Math.abs(preset.widthMm - widthMm) + Math.abs(preset.heightMm - heightMm),
      Math.abs(preset.heightMm - widthMm) + Math.abs(preset.widthMm - heightMm)
    );
    if (score < bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return {
    paperSize: best.id,
    orientation: widthMm > heightMm ? ("landscape" as const) : ("portrait" as const),
  };
}
