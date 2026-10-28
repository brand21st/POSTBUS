import { addressPartsFromParty, composeAddressLines } from "@/modules/labels/address-layout";
import {
  customTextIds,
  isCodPayment,
  LABEL_GENERATED_FROM,
  LABEL_GENERATED_FROM_SIZE,
  productTable,
} from "@/modules/labels/custom-blocks";
import { fitContain, insetBox } from "@/modules/labels/layout/fit";
import { measureHelvetica } from "@/modules/labels/layout/measure";
import { measurePaintText } from "@/modules/labels/unicode/paint";
import { layoutTableGrid, type TableCell } from "@/modules/labels/layout/table";
import { lineStep, placeLines, wrapRuns, wrapText, type PlacedLine, type TextRun } from "@/modules/labels/layout/text";
import { clampRect } from "@/modules/labels/collision";
import { mmFromPt, ptFromMm, topLeftFromStored, type PointBox } from "@/modules/labels/layout/units";
import { blockText } from "@/modules/labels/layout/values";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";
import {
  MERCHANT_ELEMENT_IDS,
  horizontalLineBars,
  type LabelTemplate,
  type TemplateElement,
} from "@/modules/labels/template-schema";

export const WATERMARK_ID = "labelGeneratedFrom";

export type LayoutAssets = {
  logo?: { width: number; height: number } | null;
  barcode?: { width: number; height: number } | null;
};

export type LayoutBlock = {
  id: string;
  kind: "border" | "logo" | "barcode" | "address" | "text" | "table" | "watermark";
  x: number;
  y: number;
  width: number;
  height: number;
  stored: PointBox;
  clip: PointBox;
  lines: PlacedLine[];
  image?: PointBox;
  barSlot?: PointBox;
  cells?: TableCell[];
  rules?: PointBox[];
  stroke?: number;
  borderPath?: PointBox;
  fontSize?: number;
  gap?: number;
  rotationDeg?: number;
  opacity?: number;
};

export type LabelLayout = {
  page: {
    widthPt: number;
    heightPt: number;
    widthMm: number;
    heightMm: number;
  };
  blocks: LayoutBlock[];
};

function paymentModeOf(data: PackingLabelData) {
  return data.paymentMode || data.paymentMethod || "";
}

export function labelPaintOrder(elements: Record<string, unknown>) {
  const extras = customTextIds(elements).filter((id) => !(MERCHANT_ELEMENT_IDS as readonly string[]).includes(id));
  return ["labelBorder", "merchantLogo", ...MERCHANT_ELEMENT_IDS.filter((id) => id !== "labelBorder" && id !== "merchantLogo"), ...extras, WATERMARK_ID];
}

function grow(
  stored: PointBox,
  contentHeight: number,
  autoHeight: boolean | undefined,
  pageWidth: number,
  pageHeight: number
): PointBox {
  const next = autoHeight === false ? stored : { ...stored, height: Math.max(stored.height, contentHeight) };
  return clampRect(next, pageWidth, pageHeight);
}

function shrinkFontToWidth(
  text: string,
  width: number,
  fontSize: number,
  weight: "normal" | "bold",
  extra: number
) {
  const inner = Math.max(1, width);
  let size = fontSize;
  let paragraphs = text ? wrapText(text, inner, (value) => measurePaintText(value, size, weight, false)) : [];
  for (let step = 0; step < 10; step += 1) {
    const widest = paragraphs.reduce(
      (max, line) => Math.max(max, measurePaintText(line, size, weight, false)),
      0
    );
    if (widest <= inner + 0.5 || size <= 6) break;
    size = Math.max(6, Math.round((size * inner) / Math.max(widest, 1) * 10) / 10);
    paragraphs = text ? wrapText(text, inner, (value) => measurePaintText(value, size, weight, false)) : [];
  }
  return { fontSize: size, paragraphs, contentHeight: paragraphs.length * lineStep(size, extra) };
}

function textBlock(
  id: string,
  kind: LayoutBlock["kind"],
  element: TemplateElement,
  stored: PointBox,
  text: string,
  weight: "normal" | "bold",
  extra: number,
  pageWidth: number,
  pageHeight: number
): LayoutBlock {
  const gap = Math.max(0, element.gap ?? 0);
  const innerWidth = Math.max(0, stored.width - gap * 2);
  const fitted = shrinkFontToWidth(text, innerWidth, element.fontSize ?? 9, weight, extra);
  const contentHeight = gap * 2 + fitted.contentHeight;
  const placed = grow(stored, contentHeight, element.autoHeight, pageWidth, pageHeight);
  const box = insetBox(placed, gap);
  const lines = placeLines({
    lines: fitted.paragraphs.map((line) => [{ text: line, bold: weight === "bold", italic: false }]),
    box,
    align: element.align ?? "left",
    fontSize: fitted.fontSize,
    extra,
    clip: placed,
    measure: (value, run) => measurePaintText(value, fitted.fontSize, run.bold ? "bold" : "normal", run.italic),
  });
  return { id, kind, ...placed, stored, clip: placed, lines, fontSize: fitted.fontSize, gap };
}

function addressBlock(
  id: string,
  element: TemplateElement,
  stored: PointBox,
  data: PackingLabelData,
  headingText: string,
  party: PackingLabelData["receiver"],
  pageWidth: number,
  pageHeight: number
): LayoutBlock {
  const composed = composeAddressLines(element.addressLayout, addressPartsFromParty(party), headingText);
  const extra = ptFromMm(composed.layout.lineGapMm);
  const gap = Math.max(0, element.gap ?? 0);
  const innerWidth = Math.max(1, stored.width - gap * 2);
  let fontSize = element.fontSize ?? 9;
  const wrapAt = (size: number) => {
    const measure = (value: string, run: Pick<TextRun, "bold" | "italic">) =>
      measurePaintText(value, size, run.bold ? "bold" : "normal", run.italic);
    const heading = composed.heading
      ? wrapRuns([{ ...composed.heading, italic: composed.heading.italic }], innerWidth, measure)
      : [];
    const body = composed.lines.flatMap((line) => wrapRuns(line, innerWidth, measure));
    return { wrapped: [...heading, ...body], measure };
  };
  let packed = wrapAt(fontSize);
  for (let step = 0; step < 10; step += 1) {
    const lineWidth = packed.wrapped.reduce((max, line) => {
      const width = line.reduce((sum, run) => sum + packed.measure(run.text, run), 0);
      return Math.max(max, width);
    }, 0);
    if (lineWidth <= innerWidth + 0.5 || fontSize <= 6) break;
    fontSize = Math.max(6, Math.round((fontSize * innerWidth) / Math.max(lineWidth, 1) * 10) / 10);
    packed = wrapAt(fontSize);
  }
  const contentHeight = gap * 2 + packed.wrapped.length * lineStep(fontSize, extra);
  const placed = grow(stored, contentHeight, element.autoHeight, pageWidth, pageHeight);
  const box = insetBox(placed, gap);
  return {
    id,
    kind: "address",
    ...placed,
    stored,
    clip: placed,
    fontSize,
    gap,
    lines: placeLines({
      lines: packed.wrapped,
      box,
      align: element.align ?? "left",
      fontSize,
      extra,
      clip: placed,
      measure: packed.measure,
    }),
  };
}

function barcodeBlock(
  element: TemplateElement,
  stored: PointBox,
  data: PackingLabelData,
  assets: LayoutAssets | undefined,
  pageWidth: number,
  pageHeight: number
): LayoutBlock {
  const article = (data.articleId ?? "").trim();
  if (!article) {
    return textBlock(
      "indiaPostBarcode",
      "barcode",
      element,
      stored,
      "India Post tracking number not available",
      element.fontWeight === "bold" ? "bold" : "normal",
      element.lineGap ?? 2,
      pageWidth,
      pageHeight
    );
  }
  const gap = Math.max(0, element.gap ?? 0);
  const fontSize = element.fontSize ?? 10;
  const showText = element.showArticleText !== false;
  const placed = stored;
  const inner = insetBox(placed, gap);
  const captionGap = 2;
  const captionHeight = showText ? fontSize + 4 : 0;
  const reserved = showText ? captionHeight + captionGap : 0;
  const barAreaHeight = Math.max(0, inner.height - reserved);
  const fitted = assets?.barcode
    ? fitContain(
        { x: 0, y: 0, width: inner.width, height: barAreaHeight },
        assets.barcode,
        { x: "center", y: "top" },
        true
      )
    : { x: 0, y: 0, width: inner.width, height: barAreaHeight };
  const groupHeight = fitted.height + reserved;
  const groupTop = inner.y + Math.max(0, (inner.height - groupHeight) / 2);
  const image = {
    x: inner.x + fitted.x,
    y: groupTop,
    width: fitted.width,
    height: fitted.height,
  };
  const barSlot = { x: image.x, y: image.y, width: image.width, height: image.height };
  const captionBox = {
    x: inner.x,
    y: image.y + image.height + (showText ? captionGap : 0),
    width: inner.width,
    height: captionHeight,
  };
  const lines = showText
    ? placeLines({
        lines: wrapText(article, captionBox.width, (value) =>
          measurePaintText(value, fontSize, element.fontWeight === "bold" ? "bold" : "normal")
        ).map((line) => [{ text: line, bold: element.fontWeight === "bold", italic: false }]),
        box: captionBox,
        align: "center",
        fontSize,
        extra: 0,
        clip: placed,
        measure: (value, run) => measurePaintText(value, fontSize, run.bold ? "bold" : "normal", run.italic),
      })
    : [];
  return {
    id: "indiaPostBarcode",
    kind: "barcode",
    ...placed,
    stored,
    clip: placed,
    lines,
    image,
    barSlot,
    fontSize,
    gap,
  };
}

export function layoutLabel(template: LabelTemplate, data: PackingLabelData, assets?: LayoutAssets): LabelLayout {
  const widthPt = template.page.widthPt;
  const heightPt = template.page.heightPt;
  const cod = isCodPayment(paymentModeOf(data));
  const blocks: LayoutBlock[] = [];

  for (const id of labelPaintOrder(template.elements)) {
    if (id === WATERMARK_ID) continue;
    const element = template.elements[id];
    if (!element?.visible) continue;
    if (id === "codAmount" && !cod) continue;
    if (id === "prepaid" && cod) continue;
    const stored = clampRect(topLeftFromStored(heightPt, element), widthPt, heightPt);

    if (id === "labelBorder") {
      const stroke = Math.min(12, Math.max(0.5, element.borderWidth ?? 1));
      const half = stroke / 2;
      blocks.push({
        id,
        kind: "border",
        ...stored,
        stored,
        clip: stored,
        lines: [],
        stroke,
        borderPath: {
          x: stored.x + half,
          y: stored.y + half,
          width: Math.max(0, stored.width - stroke),
          height: Math.max(0, stored.height - stroke),
        },
        rules: horizontalLineBars(element, heightPt).map((bar) => topLeftFromStored(heightPt, bar)),
      });
      continue;
    }

    if (id === "merchantLogo") {
      const gap = Math.max(0, element.gap ?? 0);
      const inner = insetBox(stored, gap);
      const image = assets?.logo ? fitContain(inner, assets.logo, { x: "left", y: "top" }, true) : undefined;
      blocks.push({ id, kind: "logo", ...stored, stored, clip: stored, lines: [], image, gap });
      continue;
    }

    if (id === "indiaPostBarcode") {
      blocks.push(barcodeBlock(element, stored, data, assets, widthPt, heightPt));
      continue;
    }

    if (id === "products") {
      const gap = Math.max(0, element.gap ?? 0);
      const fontSize = element.fontSize ?? 9;
      const extra = element.lineGap ?? 2;
      const table = productTable(data.items, element, {
        includeTotal: !template.elements.total?.visible,
        total: data.total,
      });
      if (!table.columns.length) {
        blocks.push({ id, kind: "table", ...stored, stored, clip: stored, lines: [], cells: [], fontSize, gap });
        continue;
      }
      const open = insetBox({ ...stored, height: Math.max(stored.height, 100000) }, gap);
      const measured = layoutTableGrid({
        table,
        frame: { ...open, height: 100000 },
        fontSize,
        extra,
        clip: { ...open, height: 100000 },
      });
      const placed = grow(stored, gap * 2 + measured.contentHeight, element.autoHeight, widthPt, heightPt);
      const frame = insetBox(placed, gap);
      const grid = table.columns.length
        ? layoutTableGrid({ table, frame, fontSize, extra, clip: placed })
        : { contentHeight: 0, cells: [], columnWidths: [] };
      blocks.push({
        id,
        kind: "table",
        ...placed,
        stored,
        clip: placed,
        lines: [],
        cells: grid.cells,
        fontSize,
        gap,
      });
      continue;
    }

    if (id === "shipTo" || id === "fromAddress") {
      const party = id === "shipTo" ? data.receiver : data.sender;
      const heading = id === "fromAddress" ? "From/ Return Address" : "Ship To:";
      blocks.push(addressBlock(id, element, stored, data, heading, party, widthPt, heightPt));
      continue;
    }

    const text = blockText(id, data, element);
    blocks.push(
      textBlock(
        id,
        "text",
        element,
        stored,
        text,
        element.fontWeight === "bold" ? "bold" : "normal",
        element.lineGap ?? 2,
        widthPt,
        heightPt
      )
    );
  }

  const diagonal = Math.hypot(widthPt, heightPt);
  let markSize = Math.min(18, diagonal / 22);
  while (markSize > 9 && measureHelvetica(LABEL_GENERATED_FROM, markSize, "normal") > diagonal * 0.72) {
    markSize -= 0.5;
  }
  markSize = Math.max(LABEL_GENERATED_FROM_SIZE + 4, markSize);
  const markWidth = measureHelvetica(LABEL_GENERATED_FROM, markSize, "normal");
  const markBox = { x: 0, y: 0, width: widthPt, height: heightPt };
  const textBox = {
    x: (widthPt - markWidth) / 2,
    y: (heightPt - markSize) / 2,
    width: markWidth,
    height: markSize,
  };
  blocks.push({
    id: WATERMARK_ID,
    kind: "watermark",
    ...markBox,
    stored: markBox,
    clip: markBox,
    fontSize: markSize,
    rotationDeg: -32,
    opacity: 0.18,
    lines: placeLines({
      lines: [[{ text: LABEL_GENERATED_FROM, bold: false, italic: false }]],
      box: textBox,
      align: "left",
      fontSize: markSize,
      extra: 0,
      clip: markBox,
      measure: (value) => measureHelvetica(value, markSize, "normal"),
    }),
  });

  return {
    page: {
      widthPt,
      heightPt,
      widthMm: template.page.widthMm ?? mmFromPt(widthPt),
      heightMm: template.page.heightMm ?? mmFromPt(heightPt),
    },
    blocks,
  };
}

export function layoutBlock(layout: LabelLayout, id: string) {
  return layout.blocks.find((block) => block.id === id);
}
