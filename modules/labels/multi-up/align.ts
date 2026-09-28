export type SlotBox = {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
};

export function boxesIntersect(a: SlotBox, b: SlotBox) {
  return (
    a.xPt < b.xPt + b.widthPt &&
    a.xPt + a.widthPt > b.xPt &&
    a.yPt < b.yPt + b.heightPt &&
    a.yPt + a.heightPt > b.yPt
  );
}

export function marqueeRect(x0: number, y0: number, x1: number, y1: number): SlotBox {
  return {
    xPt: Math.min(x0, x1),
    yPt: Math.min(y0, y1),
    widthPt: Math.abs(x1 - x0),
    heightPt: Math.abs(y1 - y0),
  };
}

/** Shared translation so every box stays on the sheet. Sizes are unchanged. */
export function clampGroupDelta(origins: SlotBox[], dx: number, dy: number, sheetWidthPt: number, sheetHeightPt: number) {
  let loX = Number.NEGATIVE_INFINITY;
  let hiX = Number.POSITIVE_INFINITY;
  let loY = Number.NEGATIVE_INFINITY;
  let hiY = Number.POSITIVE_INFINITY;
  for (const origin of origins) {
    loX = Math.max(loX, -origin.xPt);
    hiX = Math.min(hiX, sheetWidthPt - origin.widthPt - origin.xPt);
    loY = Math.max(loY, -origin.yPt);
    hiY = Math.min(hiY, sheetHeightPt - origin.heightPt - origin.yPt);
  }
  return {
    dx: Math.min(hiX, Math.max(loX, dx)) + 0,
    dy: Math.min(hiY, Math.max(loY, dy)) + 0,
  };
}

function shiftX(boxes: SlotBox[], xPt: number): SlotBox[] {
  return boxes.map((box) => ({ ...box, xPt }));
}

function shiftY(boxes: SlotBox[], yPt: number): SlotBox[] {
  return boxes.map((box) => ({ ...box, yPt }));
}

export function alignLeft(boxes: SlotBox[]): SlotBox[] {
  if (!boxes.length) return boxes;
  return shiftX(boxes, Math.min(...boxes.map((box) => box.xPt)));
}

export function alignCenterX(boxes: SlotBox[]): SlotBox[] {
  if (!boxes.length) return boxes;
  const left = Math.min(...boxes.map((box) => box.xPt));
  const right = Math.max(...boxes.map((box) => box.xPt + box.widthPt));
  const center = (left + right) / 2;
  return boxes.map((box) => ({ ...box, xPt: center - box.widthPt / 2 }));
}

export function alignRight(boxes: SlotBox[]): SlotBox[] {
  if (!boxes.length) return boxes;
  const right = Math.max(...boxes.map((box) => box.xPt + box.widthPt));
  return boxes.map((box) => ({ ...box, xPt: right - box.widthPt }));
}

export function alignTop(boxes: SlotBox[]): SlotBox[] {
  if (!boxes.length) return boxes;
  return shiftY(boxes, Math.min(...boxes.map((box) => box.yPt)));
}

export function alignMiddleY(boxes: SlotBox[]): SlotBox[] {
  if (!boxes.length) return boxes;
  const top = Math.min(...boxes.map((box) => box.yPt));
  const bottom = Math.max(...boxes.map((box) => box.yPt + box.heightPt));
  const middle = (top + bottom) / 2;
  return boxes.map((box) => ({ ...box, yPt: middle - box.heightPt / 2 }));
}

export function alignBottom(boxes: SlotBox[]): SlotBox[] {
  if (!boxes.length) return boxes;
  const bottom = Math.max(...boxes.map((box) => box.yPt + box.heightPt));
  return boxes.map((box) => ({ ...box, yPt: bottom - box.heightPt }));
}
