import {
  clip,
  endPath,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { indiaPostBarcodePng } from "@/modules/labels/india-post-barcode-image";
import type { LayoutBlock, LayoutAssets } from "@/modules/labels/layout/layout";
import { layoutLabel } from "@/modules/labels/layout/layout";
import type { PlacedLine } from "@/modules/labels/layout/text";
import type { PointBox } from "@/modules/labels/layout/units";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";
import type { LabelTemplate } from "@/modules/labels/template-schema";
import { drawPaintedText } from "@/modules/labels/unicode/paint";

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.28, 0.3, 0.34);
const HEADER = rgb(0.9, 0.93, 0.97);
const GRID = rgb(0.75, 0.78, 0.84);

function fontFor(regular: PDFFont, bold: PDFFont, italic: PDFFont, boldItalic: PDFFont, run: { bold: boolean; italic: boolean }) {
  if (run.bold && run.italic) return boldItalic;
  if (run.bold) return bold;
  if (run.italic) return italic;
  return regular;
}

export async function paintMerchantLabel(
  document: PDFDocument,
  page: PDFPage,
  template: LabelTemplate,
  data: PackingLabelData,
  opts?: { scaleX?: number; scaleY?: number }
) {
  const scaleX = opts?.scaleX ?? 1;
  const scaleY = opts?.scaleY ?? 1;
  const fontScale = Math.min(scaleX, scaleY);
  const pageHeight = page.getSize().height;
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await document.embedFont(StandardFonts.HelveticaBoldOblique);

  let logoImage: PDFImage | null = null;
  const assets: LayoutAssets = {};
  if (template.elements.merchantLogo?.visible && data.logoBytes && data.logoMime) {
    const mime = data.logoMime.toLowerCase();
    try {
      logoImage = mime.includes("png")
        ? await document.embedPng(data.logoBytes)
        : mime.includes("jpeg") || mime.includes("jpg")
          ? await document.embedJpg(data.logoBytes)
          : null;
      if (logoImage) assets.logo = { width: logoImage.width, height: logoImage.height };
    } catch {
      logoImage = null;
    }
  }

  const article = (data.articleId ?? "").trim();
  let barcodeImage: PDFImage | null = null;
  if (article && template.elements.indiaPostBarcode?.visible) {
    const png = await indiaPostBarcodePng(article);
    if (png) {
      try {
        barcodeImage = await document.embedPng(png);
        assets.barcode = { width: barcodeImage.width, height: barcodeImage.height };
      } catch {
        barcodeImage = null;
      }
    }
  }

  const layoutData = article && template.elements.indiaPostBarcode?.visible && !barcodeImage ? { ...data, articleId: "" } : data;
  const layout = layoutLabel(template, layoutData, assets);
  const pdfBox = (box: PointBox) => ({
    x: box.x * scaleX,
    y: pageHeight - (box.y + box.height) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  });
  const baselineY = (baseline: number) => pageHeight - baseline * scaleY;

  const drawLine = async (line: PlacedLine, color: ReturnType<typeof rgb>) => {
    const size = line.fontSize * fontScale;
    const y = baselineY(line.baseline);
    for (const run of line.runs) {
      if (!run.text) continue;
      await drawPaintedText(document, page, {
        text: run.text,
        x: run.x * scaleX,
        y,
        size,
        font: fontFor(regular, bold, italic, boldItalic, run),
        color,
        bold: run.bold,
        italic: run.italic,
      });
    }
  };

  const withClip = async (box: PointBox, draw: () => Promise<void>) => {
    const placed = pdfBox(box);
    if (placed.width <= 0 || placed.height <= 0) return;
    page.pushOperators(pushGraphicsState(), rectangle(placed.x, placed.y, placed.width, placed.height), clip(), endPath());
    try {
      await draw();
    } finally {
      page.pushOperators(popGraphicsState());
    }
  };

  const paint = async (block: LayoutBlock) => {
    if (block.kind === "border") {
      if (block.borderPath && block.stroke) {
        const path = pdfBox(block.borderPath);
        page.drawRectangle({
          ...path,
          borderWidth: block.stroke * fontScale,
          borderColor: INK,
        });
      }
      for (const rule of block.rules ?? []) {
        page.drawRectangle({ ...pdfBox(rule), color: INK });
      }
      return;
    }
    if (block.kind === "watermark") {
      for (const line of block.lines) await drawLine(line, MUTED);
      return;
    }
    await withClip(block.clip, async () => {
      if (block.kind === "logo" && block.image && logoImage) {
        page.drawImage(logoImage, pdfBox(block.image));
      }
      if (block.kind === "barcode" && block.image && barcodeImage) {
        page.drawImage(barcodeImage, pdfBox(block.image));
      }
      if (block.kind === "table") {
        for (const cell of block.cells ?? []) {
          const rect = pdfBox(cell);
          if (cell.header) page.drawRectangle({ ...rect, color: HEADER });
          page.drawRectangle({
            ...rect,
            borderWidth: 0.6 * fontScale,
            borderColor: GRID,
          });
          for (const line of cell.lines) await drawLine(line, INK);
        }
        return;
      }
      for (const line of block.lines) await drawLine(line, INK);
    });
  };

  for (const block of layout.blocks) await paint(block);
}
