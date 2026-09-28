import { PDFDocument, degrees } from "pdf-lib";
import type { MultiUpLayout, MultiUpPlacement } from "@/modules/labels/multi-up/layout";

export type EmbedDrawBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90;
};

/**
 * pdf-lib rotates around the draw origin, counter-clockwise.
 * A 90° turn swings the label to the left of that origin, so the origin
 * moves to the right edge of the slot. The returned width and height are
 * the unrotated label page, already scaled.
 */
export function embedDrawBox(sheetHeightPt: number, placement: MultiUpPlacement): EmbedDrawBox {
  const bottom = sheetHeightPt - placement.yPt - placement.heightPt;
  if (placement.rotation === 90) {
    return {
      x: placement.xPt + placement.widthPt,
      y: bottom,
      width: placement.heightPt,
      height: placement.widthPt,
      rotation: 90,
    };
  }
  return {
    x: placement.xPt,
    y: bottom,
    width: placement.widthPt,
    height: placement.heightPt,
    rotation: 0,
  };
}

/** Embeds finished single-label PDFs onto one sheet. Does not repaint label contents. */
export async function composeMultiUpPdf(layout: MultiUpLayout, labelPdfs: Uint8Array[]) {
  if (labelPdfs.length !== layout.placements.length) {
    throw new Error("Each placement needs the PDF of its finished label.");
  }
  const document = await PDFDocument.create();
  const pageCount = Math.max(1, ...layout.placements.map((placement) => placement.page + 1));
  const pages = Array.from({ length: pageCount }, () => document.addPage([layout.sheetWidthPt, layout.sheetHeightPt]));
  const embedded = new Map<Uint8Array, Awaited<ReturnType<PDFDocument["embedPdf"]>>[number]>();

  for (let index = 0; index < layout.placements.length; index += 1) {
    const placement = layout.placements[index]!;
    const bytes = labelPdfs[index]!;
    let page = embedded.get(bytes);
    if (!page) {
      const [embeddedPage] = await document.embedPdf(bytes, [0]);
      if (!embeddedPage) throw new Error("The label PDF has no page to place.");
      page = embeddedPage;
      embedded.set(bytes, page);
    }
    const box = embedDrawBox(layout.sheetHeightPt, placement);
    pages[placement.page]?.drawPage(page, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotate: degrees(box.rotation),
    });
  }

  return document.save();
}
