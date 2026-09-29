import { mmFromPt } from "@/modules/labels/layout/units";
import type { SlotBox } from "@/modules/labels/multi-up/align";

/** Interaction snap distance in CSS pixels, converted to sheet pt via canvasScale. */
export const SNAP_PX = 8;
export const HYSTERESIS_FACTOR = 1.5;
const NEIGHBOR_SHOW_PT = 80;

export type GuideFeature = "start" | "end" | "center";

export type SmartGuide = {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  kind: "edge" | "center";
};

export type SnapLock = {
  at: number;
  feature: GuideFeature;
  kind: SmartGuide["kind"];
};

export type SnapLocks = {
  x: SnapLock | null;
  y: SnapLock | null;
};

export type PaperGaps = {
  leftPt: number;
  rightPt: number;
  topPt: number;
  bottomPt: number;
};

export type NeighborGap = {
  axis: "x" | "y";
  gapPt: number;
  startPt: number;
  endPt: number;
  midPt: number;
};

export type SmartOverlay = {
  bbox: SlotBox;
  guides: SmartGuide[];
  paperGaps: PaperGaps;
  neighborGaps: NeighborGap[];
};

type AxisCandidate = {
  rank: number;
  delta: number;
  lock: SnapLock;
  from: number;
  to: number;
};

export function snapThresholdPt(canvasScale: number) {
  if (!(canvasScale > 0)) return SNAP_PX;
  return SNAP_PX / canvasScale;
}

export function formatMmFromPt(pt: number) {
  return `${mmFromPt(pt).toFixed(1)} mm`;
}

export function groupBounds(boxes: SlotBox[]): SlotBox | null {
  if (!boxes.length) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.xPt);
    top = Math.min(top, box.yPt);
    right = Math.max(right, box.xPt + box.widthPt);
    bottom = Math.max(bottom, box.yPt + box.heightPt);
  }
  return { xPt: left, yPt: top, widthPt: right - left, heightPt: bottom - top };
}

export function shiftBox(box: SlotBox, dx: number, dy: number): SlotBox {
  return { ...box, xPt: box.xPt + dx, yPt: box.yPt + dy };
}

export function paperGaps(bbox: SlotBox, sheetWidthPt: number, sheetHeightPt: number): PaperGaps {
  return {
    leftPt: bbox.xPt,
    rightPt: sheetWidthPt - (bbox.xPt + bbox.widthPt),
    topPt: bbox.yPt,
    bottomPt: sheetHeightPt - (bbox.yPt + bbox.heightPt),
  };
}

function rangesOverlap(a0: number, aSize: number, b0: number, bSize: number) {
  return a0 < b0 + bSize && a0 + aSize > b0;
}

export function neighborGaps(bbox: SlotBox, others: SlotBox[]): NeighborGap[] {
  const found: NeighborGap[] = [];
  let bestH: NeighborGap | null = null;
  let bestV: NeighborGap | null = null;

  for (const other of others) {
    const bboxRight = bbox.xPt + bbox.widthPt;
    const bboxBottom = bbox.yPt + bbox.heightPt;
    const otherRight = other.xPt + other.widthPt;
    const otherBottom = other.yPt + other.heightPt;

    if (rangesOverlap(bbox.yPt, bbox.heightPt, other.yPt, other.heightPt)) {
      let gapPt = 0;
      let startPt = 0;
      let endPt = 0;
      if (bboxRight <= other.xPt) {
        gapPt = other.xPt - bboxRight;
        startPt = bboxRight;
        endPt = other.xPt;
      } else if (otherRight <= bbox.xPt) {
        gapPt = bbox.xPt - otherRight;
        startPt = otherRight;
        endPt = bbox.xPt;
      }
      if (gapPt > 0 && (!bestH || gapPt < bestH.gapPt)) {
        const overlapStart = Math.max(bbox.yPt, other.yPt);
        const overlapEnd = Math.min(bboxBottom, otherBottom);
        bestH = {
          axis: "x",
          gapPt,
          startPt,
          endPt,
          midPt: (overlapStart + overlapEnd) / 2,
        };
      }
    }

    if (rangesOverlap(bbox.xPt, bbox.widthPt, other.xPt, other.widthPt)) {
      let gapPt = 0;
      let startPt = 0;
      let endPt = 0;
      if (bboxBottom <= other.yPt) {
        gapPt = other.yPt - bboxBottom;
        startPt = bboxBottom;
        endPt = other.yPt;
      } else if (otherBottom <= bbox.yPt) {
        gapPt = bbox.yPt - otherBottom;
        startPt = otherBottom;
        endPt = bbox.yPt;
      }
      if (gapPt > 0 && (!bestV || gapPt < bestV.gapPt)) {
        const overlapStart = Math.max(bbox.xPt, other.xPt);
        const overlapEnd = Math.min(bboxRight, otherRight);
        bestV = {
          axis: "y",
          gapPt,
          startPt,
          endPt,
          midPt: (overlapStart + overlapEnd) / 2,
        };
      }
    }
  }

  if (bestH && bestV) {
    found.push(bestH, bestV);
  } else if (bestH) {
    found.push(bestH);
  } else if (bestV) {
    found.push(bestV);
  }
  return found.filter((gap) => gap.gapPt <= NEIGHBOR_SHOW_PT);
}

function lockDistance(bbox: SlotBox, lock: SnapLock, axis: "x" | "y") {
  const start = axis === "x" ? bbox.xPt : bbox.yPt;
  const size = axis === "x" ? bbox.widthPt : bbox.heightPt;
  if (lock.feature === "start") return Math.abs(start - lock.at);
  if (lock.feature === "end") return Math.abs(start + size - lock.at);
  return Math.abs(start + size / 2 - lock.at);
}

function snappedStart(bbox: SlotBox, lock: SnapLock, axis: "x" | "y") {
  const size = axis === "x" ? bbox.widthPt : bbox.heightPt;
  if (lock.feature === "start") return lock.at;
  if (lock.feature === "end") return lock.at - size;
  return lock.at - size / 2;
}

function pickCandidate(candidates: AxisCandidate[], threshold: number) {
  let chosen: AxisCandidate | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.delta);
    if (distance > threshold) continue;
    if (!chosen) {
      chosen = candidate;
      continue;
    }
    const chosenDistance = Math.abs(chosen.delta);
    const nearer = distance < chosenDistance - 1e-9;
    const tied = Math.abs(distance - chosenDistance) <= 1e-6;
    if (nearer || (tied && candidate.rank < chosen.rank)) chosen = candidate;
  }
  return chosen;
}

function pushCandidate(
  list: AxisCandidate[],
  rank: number,
  delta: number,
  lock: SnapLock,
  from: number,
  to: number
) {
  list.push({ rank, delta, lock, from, to });
}

function xCandidates(bbox: SlotBox, others: SlotBox[], sheetWidthPt: number, sheetHeightPt: number) {
  const list: AxisCandidate[] = [];
  const spanFrom = 0;
  const spanTo = sheetHeightPt;

  pushCandidate(list, 1, 0 - bbox.xPt, { at: 0, feature: "start", kind: "edge" }, spanFrom, spanTo);
  pushCandidate(list, 1, sheetWidthPt - bbox.widthPt - bbox.xPt, { at: sheetWidthPt, feature: "end", kind: "edge" }, spanFrom, spanTo);

  for (const other of others) {
    const from = Math.min(bbox.yPt, other.yPt);
    const to = Math.max(bbox.yPt + bbox.heightPt, other.yPt + other.heightPt);
    const left = other.xPt;
    const right = other.xPt + other.widthPt;
    pushCandidate(list, 1, left - bbox.xPt, { at: left, feature: "start", kind: "edge" }, from, to);
    pushCandidate(list, 1, left - bbox.widthPt - bbox.xPt, { at: left, feature: "end", kind: "edge" }, from, to);
    pushCandidate(list, 1, right - bbox.xPt, { at: right, feature: "start", kind: "edge" }, from, to);
    pushCandidate(list, 1, right - bbox.widthPt - bbox.xPt, { at: right, feature: "end", kind: "edge" }, from, to);
  }

  const paperMid = sheetWidthPt / 2;
  pushCandidate(list, 2, paperMid - bbox.widthPt / 2 - bbox.xPt, { at: paperMid, feature: "center", kind: "center" }, spanFrom, spanTo);

  for (const other of others) {
    const mid = other.xPt + other.widthPt / 2;
    const from = Math.min(bbox.yPt, other.yPt);
    const to = Math.max(bbox.yPt + bbox.heightPt, other.yPt + other.heightPt);
    pushCandidate(list, 2, mid - bbox.widthPt / 2 - bbox.xPt, { at: mid, feature: "center", kind: "center" }, from, to);
  }

  return list;
}

function yCandidates(bbox: SlotBox, others: SlotBox[], sheetWidthPt: number, sheetHeightPt: number) {
  const list: AxisCandidate[] = [];
  const spanFrom = 0;
  const spanTo = sheetWidthPt;

  pushCandidate(list, 1, 0 - bbox.yPt, { at: 0, feature: "start", kind: "edge" }, spanFrom, spanTo);
  pushCandidate(list, 1, sheetHeightPt - bbox.heightPt - bbox.yPt, { at: sheetHeightPt, feature: "end", kind: "edge" }, spanFrom, spanTo);

  for (const other of others) {
    const from = Math.min(bbox.xPt, other.xPt);
    const to = Math.max(bbox.xPt + bbox.widthPt, other.xPt + other.widthPt);
    const top = other.yPt;
    const bottom = other.yPt + other.heightPt;
    pushCandidate(list, 1, top - bbox.yPt, { at: top, feature: "start", kind: "edge" }, from, to);
    pushCandidate(list, 1, top - bbox.heightPt - bbox.yPt, { at: top, feature: "end", kind: "edge" }, from, to);
    pushCandidate(list, 1, bottom - bbox.yPt, { at: bottom, feature: "start", kind: "edge" }, from, to);
    pushCandidate(list, 1, bottom - bbox.heightPt - bbox.yPt, { at: bottom, feature: "end", kind: "edge" }, from, to);
  }

  const paperMid = sheetHeightPt / 2;
  pushCandidate(list, 2, paperMid - bbox.heightPt / 2 - bbox.yPt, { at: paperMid, feature: "center", kind: "center" }, spanFrom, spanTo);

  for (const other of others) {
    const mid = other.yPt + other.heightPt / 2;
    const from = Math.min(bbox.xPt, other.xPt);
    const to = Math.max(bbox.xPt + bbox.widthPt, other.xPt + other.widthPt);
    pushCandidate(list, 2, mid - bbox.heightPt / 2 - bbox.yPt, { at: mid, feature: "center", kind: "center" }, from, to);
  }

  return list;
}

function resolveAxis(
  intended: SlotBox,
  origin: SlotBox,
  axis: "x" | "y",
  candidates: AxisCandidate[],
  thresholdPt: number,
  locked: SnapLock | null
): { shift: number; lock: SnapLock | null; guide: SmartGuide | null } {
  const intendedShift = axis === "x" ? intended.xPt - origin.xPt : intended.yPt - origin.yPt;
  const release = thresholdPt * HYSTERESIS_FACTOR;

  if (locked && lockDistance(intended, locked, axis) <= release) {
    const start = snappedStart(intended, locked, axis);
    const originStart = axis === "x" ? origin.xPt : origin.yPt;
    return {
      shift: start - originStart,
      lock: locked,
      guide: {
        axis,
        at: locked.at,
        from: axis === "x" ? 0 : 0,
        to: axis === "x" ? intended.heightPt + intended.yPt : intended.widthPt + intended.xPt,
        kind: locked.kind,
      },
    };
  }

  const chosen = pickCandidate(candidates, thresholdPt);
  if (!chosen) {
    return { shift: intendedShift, lock: null, guide: null };
  }
  return {
    shift: chosen.delta + intendedShift,
    lock: chosen.lock,
    guide: {
      axis,
      at: chosen.lock.at,
      from: chosen.from,
      to: chosen.to,
      kind: chosen.lock.kind,
    },
  };
}

export function applySmartSnap(input: {
  originBbox: SlotBox;
  others: SlotBox[];
  sheetWidthPt: number;
  sheetHeightPt: number;
  intendedDx: number;
  intendedDy: number;
  thresholdPt: number;
  locked: SnapLocks;
}): { dx: number; dy: number; locked: SnapLocks; overlay: SmartOverlay } {
  const intended = shiftBox(input.originBbox, input.intendedDx, input.intendedDy);
  const xResult = resolveAxis(
    intended,
    input.originBbox,
    "x",
    xCandidates(intended, input.others, input.sheetWidthPt, input.sheetHeightPt),
    input.thresholdPt,
    input.locked.x
  );
  const yResult = resolveAxis(
    intended,
    input.originBbox,
    "y",
    yCandidates(intended, input.others, input.sheetWidthPt, input.sheetHeightPt),
    input.thresholdPt,
    input.locked.y
  );

  const snapped = shiftBox(input.originBbox, xResult.shift, yResult.shift);
  const guides = [xResult.guide, yResult.guide].filter((guide): guide is SmartGuide => Boolean(guide));
  for (const guide of guides) {
    if (guide.axis === "x") {
      guide.from = 0;
      guide.to = input.sheetHeightPt;
    } else {
      guide.from = 0;
      guide.to = input.sheetWidthPt;
    }
  }

  return {
    dx: xResult.shift,
    dy: yResult.shift,
    locked: { x: xResult.lock, y: yResult.lock },
    overlay: overlayForBox(snapped, input.others, input.sheetWidthPt, input.sheetHeightPt, guides),
  };
}

export function overlayForBox(bbox: SlotBox, others: SlotBox[], sheetWidthPt: number, sheetHeightPt: number, guides: SmartGuide[]): SmartOverlay {
  return {
    bbox,
    guides,
    paperGaps: paperGaps(bbox, sheetWidthPt, sheetHeightPt),
    neighborGaps: neighborGaps(bbox, others),
  };
}

export const emptySnapLocks = (): SnapLocks => ({ x: null, y: null });
