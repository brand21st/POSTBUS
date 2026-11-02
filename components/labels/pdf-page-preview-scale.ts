export function pdfPagePreviewScale(input: {
  pageWidthPt: number;
  cssWidthPx?: number;
  devicePixelRatio?: number;
  minScale?: number;
  maxScale?: number;
}) {
  const minScale = input.minScale ?? 3;
  const maxScale = input.maxScale ?? 5;
  const dpr = input.devicePixelRatio ?? 2;
  const cssWidthPx = input.cssWidthPx ?? input.pageWidthPt;
  if (!(input.pageWidthPt > 0) || !(cssWidthPx > 0) || !(dpr > 0)) return minScale;
  const needed = (cssWidthPx * dpr) / input.pageWidthPt;
  return Math.min(maxScale, Math.max(minScale, needed));
}
