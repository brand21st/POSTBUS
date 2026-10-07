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

function grow(stored: PointBox, contentHeight: number, autoHeight: boolean | undefined): PointBox {
  if (autoHeight === false) return stored;
  return { ...stored, height: Math.max(stored.height, contentHeight) };
}

function textBlock(
  id: string,
  kind: LayoutBlock["kind"],
  element: TemplateElement,
  stored: PointBox,
  text: string,
  weight: "normal" | "bold",
  extra: number
): LayoutBlock {
  const gap = Math.max(0, element.gap ?? 0);
  const fontSize = element.fontSize ?? 9;
  const innerWidth = Math.max(0, stored.width - gap * 2);
  const paragraphs = text ? wrapText(text, innerWidth, (value) => measurePaintText(value, fontSize, weight, false)) : [];
  const contentHeight = gap * 2 + paragraphs.length * lineStep(fontSize, extra);
  const placed = grow(stored, contentHeight, element.autoHeight);
  const box = insetBox(placed, gap);
  const lines = placeLines({
    lines: paragraphs.map((line) => [{ text: line, bold: weight === "bold", italic: false }]),
    box,
    align: element.align ?? "left",
    fontSize,
    extra,
    clip: placed,
    measure: (value, run) => measurePaintText(value, fontSize, run.bold ? "bold" : "normal", run.italic),
  });
  return { id, kind, ...placed, stored, clip: placed, lines, fontSize, gap };
}

function addressBlock(
  id: string,
  element: TemplateElement,
  stored: PointBox,
  data: PackingLabelData,
  headingText: string,
  party: PackingLabelData["receiver"]
): LayoutBlock {
  const composed = composeAddressLines(element.addressLayout, addressPartsFromParty(party), headingText);
  const fontSize = element.fontSize ?? 9;
  const extra = ptFromMm(composed.layout.lineGapMm);
  const gap = Math.max(0, element.gap ?? 0);
  const innerWidth = Math.max(0, stored.width - gap * 2);
  const measure = (text: string, run: Pick<TextRun, "bold" | "italic">) =>
    measurePaintText(text, fontSize, run.bold ? "bold" : "normal", run.italic);
  const heading = composed.heading ? wrapRuns([{ ...composed.heading, italic: composed.heading.italic }], innerWidth, measure) : [];
  const body = composed.lines.flatMap((line) => wrapRuns(line, innerWidth, measure));
  const wrapped = [...heading, ...body];
  const contentHeight = gap * 2 + wrapped.length * lineStep(fontSize, extra);
  const placed = grow(stored, contentHeight, element.autoHeight);
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
      lines: wrapped,
      box,
      align: element.align ?? "left",
      fontSize,
      extra,
      clip: placed,
      measure,
    }),
  };
}

function barcodeBlock(
  element: TemplateElement,
  stored: PointBox,
  data: PackingLabelData,
  assets: LayoutAssets | undefined
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
      element.lineGap ?? 2
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
    const stored = topLeftFromStored(heightPt, element);

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
      blocks.push(barcodeBlock(element, stored, data, assets));
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
      const placed = grow(stored, gap * 2 + measured.contentHeight, element.autoHeight);
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
      blocks.push(addressBlock(id, element, stored, data, heading, party));
      continue;
    }

    const text = blockText(id, data, element);
    blocks.push(
      textBlock(id, "text", element, stored, text, element.fontWeight === "bold" ? "bold" : "normal", element.lineGap ?? 2)
    );
  }

  const markSize = LABEL_GENERATED_FROM_SIZE;
  const markWidth = measureHelvetica(LABEL_GENERATED_FROM, markSize, "normal");
  const markX = Math.max(2, (widthPt - markWidth) / 2);
  const markBox = { x: 0, y: 3, width: widthPt, height: markSize };
  blocks.push({
    id: WATERMARK_ID,
    kind: "watermark",
    ...markBox,
    stored: markBox,
    clip: { x: 0, y: 0, width: widthPt, height: heightPt },
    fontSize: markSize,
    lines: placeLines({
      lines: [[{ text: LABEL_GENERATED_FROM, bold: false, italic: false }]],
      box: { x: markX, y: 3, width: markWidth, height: markSize },
      align: "left",
      fontSize: markSize,
      extra: 0,
      clip: { y: 0, height: heightPt },
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
