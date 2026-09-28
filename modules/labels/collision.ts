import { ptFromMm } from "@/modules/labels/layout/units";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Unprintable edge on 4×6 and A6 printers. */
export const SAFE_MARGIN_PT = ptFromMm(3);
export const SAFE_MARGIN_SNAP_PT = 4;

export function rectsOverlap(a: Rect, b: Rect, gap = 2) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function clampRect(rect: Rect, pageWidth: number, pageHeight: number): Rect {
  const width = Math.min(Math.max(1, rect.width), pageWidth);
  const height = Math.min(Math.max(1, rect.height), pageHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(0, rect.x), Math.max(0, pageWidth - width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, pageHeight - height)),
  };
}

function nearerEdge(distanceA: number, distanceB: number, threshold: number) {
  if (distanceA <= threshold && distanceA <= distanceB) return "a" as const;
  if (distanceB <= threshold) return "b" as const;
  return null;
}

/** Pull a top-left rect onto the print-safe inset. One edge per axis, so a wide block is not pulled both ways. */
export function snapToSafeMargin(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
  options?: { resize?: boolean; margin?: number; threshold?: number }
): Rect {
  const margin = options?.margin ?? SAFE_MARGIN_PT;
  const threshold = options?.threshold ?? SAFE_MARGIN_SNAP_PT;
  const rightGuide = pageWidth - margin;
  const bottomGuide = pageHeight - margin;
  let { x, y, width, height } = rect;

  if (options?.resize) {
    if (Math.abs(x + width - rightGuide) <= threshold) width = Math.max(1, rightGuide - x);
    if (Math.abs(y + height - bottomGuide) <= threshold) height = Math.max(1, bottomGuide - y);
    return { x, y, width, height };
  }

  const horizontal = nearerEdge(Math.abs(x - margin), Math.abs(x + width - rightGuide), threshold);
  if (horizontal === "a") x = margin;
  if (horizontal === "b") x = rightGuide - width;
  const vertical = nearerEdge(Math.abs(y - margin), Math.abs(y + height - bottomGuide), threshold);
  if (vertical === "a") y = margin;
  if (vertical === "b") y = bottomGuide - height;
  return { x, y, width, height };
}

export function entersPrinterMargin(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
  margin = SAFE_MARGIN_PT
) {
  return (
    rect.x < margin - 0.05 ||
    rect.y < margin - 0.05 ||
    rect.x + rect.width > pageWidth - margin + 0.05 ||
    rect.y + rect.height > pageHeight - margin + 0.05
  );
}

export function overlapsAny(rect: Rect, others: Rect[]) {  return others.some((other) => rectsOverlap(rect, other));
}

export function snapRect(
  rect: Rect,
  others: Rect[],
  pageWidth: number,
  pageHeight: number
): { rect: Rect; snapped: boolean } {
  const start = clampRect(rect, pageWidth, pageHeight);
  if (!overlapsAny(start, others)) return { rect: start, snapped: false };

  const steps = [4, 8, 12, 16, 24, 32, 48, 64, 96];
  const directions = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
  for (const step of steps) {
    for (const dir of directions) {
      const candidate = clampRect(
        {
          ...start,
          x: start.x + dir.x * step,
          y: start.y + dir.y * step,
        },
        pageWidth,
        pageHeight
      );
      if (!overlapsAny(candidate, others)) return { rect: candidate, snapped: true };
    }
  }
  return { rect: start, snapped: true };
}
