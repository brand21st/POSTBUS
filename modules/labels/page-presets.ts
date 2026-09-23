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

function mmToPt(mm: number) {
  return (mm * 72) / 25.4;
}

export const PAGE_PRESETS: PagePreset[] = [
  { id: "A6", label: "A6 (105 × 148 mm)", widthMm: 105, heightMm: 148, widthPt: mmToPt(105), heightPt: mmToPt(148) },
  { id: "4x6", label: "4 × 6 in (102 × 152 mm)", widthMm: 102, heightMm: 152, widthPt: mmToPt(102), heightPt: mmToPt(152) },
  { id: "A5", label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210, widthPt: mmToPt(148), heightPt: mmToPt(210) },
  { id: "A4", label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297, widthPt: mmToPt(210), heightPt: mmToPt(297) },
];

export function isPaperSizeId(value: string | null | undefined): value is PaperSizeId {
  return PAPER_SIZE_IDS.includes(value as PaperSizeId);
}

export function pagePreset(id: string | null | undefined): PagePreset {
  return PAGE_PRESETS.find((item) => item.id === id) ?? PAGE_PRESETS[0];
}

export function agentPaperSize(id: string | null | undefined) {
  const preset = pagePreset(id);
  return preset.id === "4x6" ? "4x6" : preset.id;
}
