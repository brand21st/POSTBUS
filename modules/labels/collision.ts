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

export type GuideLine = {
  /** "x" is a vertical line, "y" is a horizontal line. */
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  kind: "edge" | "gap";
};

type GuideCandidate = {
  delta: number;
  apply: (rect: Rect) => Rect;
  guide: GuideLine;
};

function rangesOverlap(start: number, size: number, otherStart: number, otherSize: number) {
  return start < otherStart + otherSize && start + size > otherStart;
}

function nearestCandidate(candidates: GuideCandidate[], threshold: number) {
  let chosen: GuideCandidate | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.delta);
    if (distance > threshold) continue;
    if (!chosen || distance < Math.abs(chosen.delta)) chosen = candidate;
  }
  return chosen;
}

function verticalGuide(at: number, pageHeight: number, kind: GuideLine["kind"] = "edge"): GuideLine {
  return { axis: "x", at, from: 0, to: pageHeight, kind };
}

function horizontalGuide(at: number, pageWidth: number, kind: GuideLine["kind"] = "edge"): GuideLine {
  return { axis: "y", at, from: 0, to: pageWidth, kind };
}

function spacingGaps(others: Rect[], axis: "x" | "y") {
  const gaps: number[] = [];
  for (let index = 0; index < others.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < others.length; otherIndex += 1) {
      const a = others[index];
      const b = others[otherIndex];
      if (!a || !b) continue;
      const cross =
        axis === "x"
          ? rangesOverlap(a.y, a.height, b.y, b.height)
          : rangesOverlap(a.x, a.width, b.x, b.width);
      if (!cross) continue;
      const gap =
        axis === "x"
          ? a.x <= b.x
            ? b.x - (a.x + a.width)
            : a.x - (b.x + b.width)
          : a.y <= b.y
            ? b.y - (a.y + a.height)
            : a.y - (b.y + b.height);
      if (gap > 0.5) gaps.push(gap);
    }
  }
  return gaps;
}

function gapGuide(axis: "x" | "y", from: number, to: number, at: number): GuideLine {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return axis === "x"
    ? { axis: "y", at, from: start, to: end, kind: "gap" }
    : { axis: "x", at, from: start, to: end, kind: "gap" };
}

/** Snap a top-left rect to the print margin, other block edges and centers, and matching gaps. */
export function snapToGuides(
  rect: Rect,
  others: Rect[],
  pageWidth: number,
  pageHeight: number,
  options?: { resize?: boolean; margin?: number; threshold?: number }
): { rect: Rect; guides: GuideLine[] } {
  const margin = options?.margin ?? SAFE_MARGIN_PT;
  const threshold = options?.threshold ?? SAFE_MARGIN_SNAP_PT;
  const resize = Boolean(options?.resize);
  const marginRect = snapToSafeMargin(rect, pageWidth, pageHeight, { resize, margin, threshold });
  const xCandidates: GuideCandidate[] = [];
  const yCandidates: GuideCandidate[] = [];

  if (resize) {
    if (marginRect.width !== rect.width) {
      xCandidates.push({
        delta: marginRect.width - rect.width,
        apply: (current) => ({ ...current, width: marginRect.width }),
        guide: verticalGuide(rect.x + marginRect.width, pageHeight),
      });
    }
    if (marginRect.height !== rect.height) {
      yCandidates.push({
        delta: marginRect.height - rect.height,
        apply: (current) => ({ ...current, height: marginRect.height }),
        guide: horizontalGuide(rect.y + marginRect.height, pageWidth),
      });
    }
  } else {
    const onVerticalMargin =
      Math.abs(rect.x - margin) <= 0.05 || Math.abs(rect.x + rect.width - (pageWidth - margin)) <= 0.05;
    const onHorizontalMargin =
      Math.abs(rect.y - margin) <= 0.05 || Math.abs(rect.y + rect.height - (pageHeight - margin)) <= 0.05;
    if (marginRect.x !== rect.x || onVerticalMargin) {
      const at = Math.abs(marginRect.x - margin) <= Math.abs(marginRect.x + rect.width - (pageWidth - margin)) ? margin : pageWidth - margin;
      xCandidates.push({
        delta: marginRect.x - rect.x,
        apply: (current) => ({ ...current, x: marginRect.x }),
        guide: verticalGuide(at, pageHeight),
      });
    }
    if (marginRect.y !== rect.y || onHorizontalMargin) {
      const at = Math.abs(marginRect.y - margin) <= Math.abs(marginRect.y + rect.height - (pageHeight - margin)) ? margin : pageHeight - margin;
      yCandidates.push({
        delta: marginRect.y - rect.y,
        apply: (current) => ({ ...current, y: marginRect.y }),
        guide: horizontalGuide(at, pageWidth),
      });
    }
  }

  const xGaps = spacingGaps(others, "x");
  const yGaps = spacingGaps(others, "y");
  for (const other of others) {
    const xTargets = [other.x, other.x + other.width, other.x + other.width / 2];
    const yTargets = [other.y, other.y + other.height, other.y + other.height / 2];
    if (resize) {
      for (const target of xTargets) {
        const width = target - rect.x;
        if (width < 1) continue;
        xCandidates.push({
          delta: width - rect.width,
          apply: (current) => ({ ...current, width }),
          guide: verticalGuide(target, pageHeight),
        });
      }
      for (const gap of xGaps) {
        const right = other.x - gap;
        const width = right - rect.x;
        if (width < 1) continue;
        xCandidates.push({
          delta: width - rect.width,
          apply: (current) => ({ ...current, width }),
          guide: gapGuide("x", rect.x + width, other.x, other.y + other.height / 2),
        });
      }
      for (const target of yTargets) {
        const height = target - rect.y;
        if (height < 1) continue;
        yCandidates.push({
          delta: height - rect.height,
          apply: (current) => ({ ...current, height }),
          guide: horizontalGuide(target, pageWidth),
        });
      }
      for (const gap of yGaps) {
        const bottom = other.y - gap;
        const height = bottom - rect.y;
        if (height < 1) continue;
        yCandidates.push({
          delta: height - rect.height,
          apply: (current) => ({ ...current, height }),
          guide: gapGuide("y", rect.y + height, other.y, other.x + other.width / 2),
        });
      }
      continue;
    }

    for (const target of xTargets) {
      xCandidates.push({
        delta: target - rect.x,
        apply: (current) => ({ ...current, x: target }),
        guide: verticalGuide(target, pageHeight),
      });
      xCandidates.push({
        delta: target - rect.width - rect.x,
        apply: (current) => ({ ...current, x: target - rect.width }),
        guide: verticalGuide(target, pageHeight),
      });
      xCandidates.push({
        delta: target - rect.width / 2 - rect.x,
        apply: (current) => ({ ...current, x: target - rect.width / 2 }),
        guide: verticalGuide(target, pageHeight),
      });
    }
    for (const gap of xGaps) {
      const leftOf = other.x - gap - rect.width;
      const rightOf = other.x + other.width + gap;
      xCandidates.push({
        delta: rightOf - rect.x,
        apply: (current) => ({ ...current, x: rightOf }),
        guide: gapGuide("x", other.x + other.width, rightOf, other.y + other.height / 2),
      });
      xCandidates.push({
        delta: leftOf - rect.x,
        apply: (current) => ({ ...current, x: leftOf }),
        guide: gapGuide("x", leftOf + rect.width, other.x, other.y + other.height / 2),
      });
    }
    for (const target of yTargets) {
      yCandidates.push({
        delta: target - rect.y,
        apply: (current) => ({ ...current, y: target }),
        guide: horizontalGuide(target, pageWidth),
      });
      yCandidates.push({
        delta: target - rect.height - rect.y,
        apply: (current) => ({ ...current, y: target - rect.height }),
        guide: horizontalGuide(target, pageWidth),
      });
      yCandidates.push({
        delta: target - rect.height / 2 - rect.y,
        apply: (current) => ({ ...current, y: target - rect.height / 2 }),
        guide: horizontalGuide(target, pageWidth),
      });
    }
    for (const gap of yGaps) {
      const above = other.y - gap - rect.height;
      const below = other.y + other.height + gap;
      yCandidates.push({
        delta: below - rect.y,
        apply: (current) => ({ ...current, y: below }),
        guide: gapGuide("y", other.y + other.height, below, other.x + other.width / 2),
      });
      yCandidates.push({
        delta: above - rect.y,
        apply: (current) => ({ ...current, y: above }),
        guide: gapGuide("y", above + rect.height, other.y, other.x + other.width / 2),
      });
    }
  }

  const xSnap = nearestCandidate(xCandidates, threshold);
  const ySnap = nearestCandidate(yCandidates, threshold);
  let next = rect;
  const guides: GuideLine[] = [];
  if (xSnap) {
    next = xSnap.apply(next);
    guides.push(xSnap.guide);
  }
  if (ySnap) {
    next = ySnap.apply(next);
    guides.push(ySnap.guide);
  }
  return { rect: next, guides };
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
