export type PointBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function ptFromMm(mm: number) {
  return (mm * 72) / 25.4;
}

export function mmFromPt(pt: number) {
  return (pt * 25.4) / 72;
}

/** Stored boxes use a bottom-left origin. Layout boxes use a top-left origin. */
export function topLeftFromStored(pageHeightPt: number, element: PointBox): PointBox {
  return {
    x: element.x,
    y: pageHeightPt - element.y - element.height,
    width: element.width,
    height: element.height,
  };
}

export function storedFromTopLeft(pageHeightPt: number, box: PointBox): PointBox {
  return {
    x: box.x,
    y: pageHeightPt - box.y - box.height,
    width: box.width,
    height: box.height,
  };
}
