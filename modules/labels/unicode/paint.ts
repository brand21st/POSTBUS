import { type PDFDocument, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { unicodeLabelRenderingEnabled } from "@/modules/labels/unicode/flag";
import { measureShapedText, rasterizeShapedLine, wrapShapedText } from "@/modules/labels/unicode/shaped";
import { sanitizeLabelText } from "@/modules/labels/unicode/text";
import { isWinAnsiText } from "@/modules/labels/unicode/winansi";
import { measureHelvetica, type FontWeight } from "@/modules/labels/layout/measure";

type Weight = FontWeight;

const imageCache = new WeakMap<PDFDocument, Map<string, PDFImage>>();

export function needsUnicodePaint(text: string) {
  if (!unicodeLabelRenderingEnabled()) return false;
  return !isWinAnsiText(sanitizeLabelText(text));
}

export function measurePaintText(text: string, fontSize: number, weight: Weight = "normal", italic = false) {
  const value = sanitizeLabelText(text);
  if (!value) return 0;
  if (!needsUnicodePaint(value)) return measureHelvetica(value, fontSize, weight, italic);
  return measureShapedText(value, fontSize, weight);
}

export function wrapPaintText(text: string, maxWidth: number, fontSize: number, weight: Weight = "normal") {
  const value = sanitizeLabelText(text);
  if (!needsUnicodePaint(value)) {
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    const widthOf = (candidate: string) => measureHelvetica(candidate, fontSize, weight, false);
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (widthOf(next) <= maxWidth) current = next;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : value ? [value] : [""];
  }
  return wrapShapedText(value, maxWidth, fontSize, weight);
}

function colorKey(color: RGB) {
  return `${color.red.toFixed(3)},${color.green.toFixed(3)},${color.blue.toFixed(3)}`;
}

export async function drawPaintedText(
  document: PDFDocument,
  page: PDFPage,
  input: {
    text: string;
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    color: RGB;
    bold?: boolean;
    italic?: boolean;
    align?: "left" | "right";
  }
) {
  const text = sanitizeLabelText(input.text);
  if (!text) return 0;
  const weight: Weight = input.bold ? "bold" : "normal";
  if (!needsUnicodePaint(text)) {
    const width = input.font.widthOfTextAtSize(text, input.size);
    const x = input.align === "right" ? input.x - width : input.x;
    page.drawText(text, { x, y: input.y, size: input.size, font: input.font, color: input.color });
    return width;
  }
  const raster = rasterizeShapedLine({
    text,
    fontSizePt: input.size,
    weight,
    color: { r: input.color.red, g: input.color.green, b: input.color.blue },
  });
  const key = `${text}\0${input.size}\0${weight}\0${colorKey(input.color)}`;
  let cache = imageCache.get(document);
  if (!cache) {
    cache = new Map();
    imageCache.set(document, cache);
  }
  let image = cache.get(key);
  if (!image) {
    image = await document.embedPng(raster.png);
    cache.set(key, image);
  }
  const width = raster.widthPt;
  const x = input.align === "right" ? input.x - width : input.x;
  page.drawImage(image, {
    x,
    y: input.y - (raster.heightPt - raster.baselineFromTopPt),
    width: raster.widthPt,
    height: raster.heightPt,
  });
  return width;
}

