export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function rectsOverlap(a: Rect, b: Rect, gap = 2) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function clampRect(rect: Rect, pageWidth: number, pageHeight: number): Rect {
  const width = Math.min(Math.max(24, rect.width), pageWidth);
  const height = Math.min(Math.max(12, rect.height), pageHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(0, rect.x), Math.max(0, pageWidth - width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, pageHeight - height)),
  };
}

export function overlapsAny(rect: Rect, others: Rect[]) {
  return others.some((other) => rectsOverlap(rect, other));
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
