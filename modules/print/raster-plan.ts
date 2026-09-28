import { mmFromPt } from "@/modules/labels/layout/units";

export const THERMAL_DPI = 203;

export type LabelRasterPlan = {
  dpi: number;
  scaleX: number;
  scaleY: number;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  paddedWidthPx: number;
};

export function labelRasterPlan(input: {
  widthPt: number;
  heightPt: number;
  maxWidthMm: number;
  dpi?: number;
}): LabelRasterPlan {
  const dpi = input.dpi ?? THERMAL_DPI;
  if (!(input.widthPt > 0) || !(input.heightPt > 0) || !(input.maxWidthMm > 0) || !(dpi > 0)) {
    throw new Error("The label page size is invalid.");
  }
  const scale = dpi / 72;
  const widthMm = mmFromPt(input.widthPt);
  const heightMm = mmFromPt(input.heightPt);
  if (widthMm - input.maxWidthMm > 0.5) {
    throw new Error("This label is wider than the printer can print. It was not resized.");
  }
  const widthPx = Math.max(1, Math.round(input.widthPt * scale));
  const heightPx = Math.max(1, Math.round(input.heightPt * scale));
  return {
    dpi,
    scaleX: scale,
    scaleY: scale,
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    paddedWidthPx: Math.ceil(widthPx / 8) * 8,
  };
}

export function packMonoBitmap(rgba: Uint8ClampedArray, width: number, height: number, paddedWidth: number) {
  if (paddedWidth < width || paddedWidth % 8 !== 0) {
    throw new Error("The label could not be prepared without resizing.");
  }
  const widthBytes = paddedWidth / 8;
  const bytes = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = rgba[index + 3] ?? 0;
      const luminance = (rgba[index] ?? 255) * 0.299 + (rgba[index + 1] ?? 255) * 0.587 + (rgba[index + 2] ?? 255) * 0.114;
      if (alpha >= 128 && luminance < 128) {
        const byteIndex = y * widthBytes + (x >> 3);
        bytes[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }
  return bytes;
}
