import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { addressPartsFromParty, composeAddressLines, helveticaTextWidth, mmToPt, wrapAddressRuns, type AddressLayout } from "@/modules/labels/address-layout";
import { articleContractLine, codBlockHeight, codAmountLines, customTextBlockHeight, customTextIds, customerIdLine, isCodPayment, isCustomTextId, LABEL_GENERATED_FROM, LABEL_GENERATED_FROM_SIZE, parcelSizeLines, productColumnWidths, productTable, productTableHeight, wrapProductCell, serviceContractLine } from "@/modules/labels/custom-blocks";
import { indiaPostBarcodePng } from "@/modules/labels/india-post-barcode-image";
import { pagePreset } from "@/modules/labels/page-presets";
import {
  MERCHANT_ELEMENT_IDS,
  fitAddressBox,
  growAutoHeightBox,
  labelPageSize,
  horizontalLineBars,
  parseLabelTemplate,
  type LabelTemplate,
  type MerchantElementId,
  type TemplateElement,
} from "@/modules/labels/template-schema";

export type PackingLineItem = {
  title: string;
  sku?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  weightGrams?: number | null;
  note?: string | null;
};

export function packingItemName(item: { title?: string | null; sku?: string | null }) {
  const title = String(item.title ?? "").trim();
  if (title && !/^item$/i.test(title)) return title;
  const sku = String(item.sku ?? "").trim();
  return sku || "Item";
}

export type PackingParty = {
  name: string;
  phone: string;
  lines: string[];
  street?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  altMobile?: string;
  email?: string;
};

export type PackingLabelData = {
  storeName: string;
  storePhone: string;
  storeWebsite: string;
  orderNumber: string;
  shopifyOrderNumber: string;
  orderDate: string;
  items: PackingLineItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  codAmount: number;
  paymentMethod: string;
  customerNote: string;
  returnAddress: string;
  receiver: PackingParty;
  sender: PackingParty;
  billing?: PackingParty | null;
  logoBytes?: Uint8Array | null;
  logoMime?: string | null;
  articleId?: string;
  articleType?: string;
  contractId?: string;
  customerId?: string;
  paymentMode?: string;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

const SLIP_WIDTH = 595.28;
const SLIP_HEIGHT = 841.89;
const SLIP_MARGIN = 48;

function money(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}…`, size) > maxWidth) {
    value = value.slice(0, -1);
  }
  return value ? `${value}…` : "";
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawWrapped(
  page: PDFPage,
  font: PDFFont,
  text: string,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    align: "left" | "center" | "right";
    lineGap?: number;
    gap?: number;
  }
) {
  const box = insetTextBox(opts);
  const lines = wrapLines(font, text, opts.size, box.width);
  const lineHeight = opts.size + (opts.lineGap ?? 2);
  const maxLines = Math.max(1, Math.floor(box.height / lineHeight));
  const shown = lines.slice(0, maxLines);
  shown.forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, opts.size);
    let x = box.x;
    if (opts.align === "center") x = box.x + (box.width - width) / 2;
    if (opts.align === "right") x = box.x + box.width - width;
    const y = box.y + box.height - (index + 1) * lineHeight;
    if (y < box.y) return;
    page.drawText(line, { x: Math.max(0, x), y, size: opts.size, font, color: rgb(0.07, 0.09, 0.15) });
  });
}

function insetTextBox(opts: { x: number; y: number; width: number; height: number; gap?: number }) {
  const pad = Math.max(0, opts.gap ?? 0);
  return {
    x: opts.x + pad,
    y: opts.y + pad,
    width: Math.max(4, opts.width - pad * 2),
    height: Math.max(4, opts.height - pad * 2),
  };
}

function drawProductTable(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  element: LabelTemplate["elements"][string],
  data: PackingLabelData,
  placed: { x: number; y: number; width: number; height: number },
  size: number,
  includeTotal: boolean
) {
  const pad = Math.max(0, element.gap ?? 0);
  const frame = insetTextBox({ ...placed, gap: pad });
  const table = productTable(data.items, element, { includeTotal, total: data.total });
  if (!table.columns.length) return;
  const lineHeight = size + (element.lineGap ?? 2);
  const rowPad = 4;
  const widths = productColumnWidths(table.columns, frame.width);
  const border = rgb(0.75, 0.78, 0.84);
  const headerFill = rgb(0.9, 0.93, 0.97);
  const ink = rgb(0.07, 0.09, 0.15);
  const wrappedRows = [
    table.columns.map((column, index) => wrapProductCell(column.label, Math.max(4, (widths[index] ?? frame.width) - 6), size, true)),
    ...table.rows.map((row) =>
      row.cells.map((cell, index) => wrapProductCell(cell, Math.max(4, (widths[index] ?? frame.width) - 6), size, Boolean(row.bold)))
    ),
  ];
  const heights = wrappedRows.map((cells) => Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight + rowPad);
  let top = frame.y + frame.height;
  wrappedRows.forEach((cells, index) => {
    const height = heights[index] ?? lineHeight + rowPad;
    top -= height;
    if (top < frame.y - 0.5) return;
    if (index === 0) {
      page.drawRectangle({
        x: frame.x,
        y: top,
        width: frame.width,
        height,
        color: headerFill,
      });
    }
    const rowFont = index === 0 || table.rows[index - 1]?.bold ? bold : font;
    let x = frame.x;
    cells.forEach((lines, columnIndex) => {
      const width = widths[columnIndex] ?? 0;
      page.drawRectangle({
        x,
        y: top,
        width,
        height,
        borderWidth: 0.6,
        borderColor: border,
      });
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + 3,
          y: top + height - (lineIndex + 1) * lineHeight + Math.max(1, (lineHeight - size) / 2),
          size,
          font: rowFont,
          color: ink,
        });
      });
      x += width;
    });
  });
}

function valueFor(id: string, data: PackingLabelData, template: LabelTemplate) {
  const element = template.elements[id];
  if (isCustomTextId(id)) return element?.content?.trim() || "";
  switch (id) {
    case "receiverName":
      return data.receiver.name ? `TO: ${data.receiver.name}` : "";
    case "receiverAddress":
      return data.receiver.lines.join(", ");
    case "receiverPhone":
      return data.receiver.phone ? `Ph: ${data.receiver.phone}` : "";
    case "senderName":
      return data.sender.name ? `FROM: ${data.sender.name}` : "";
    case "senderAddress":
      return data.sender.lines.join(", ");
    case "senderPhone":
      return data.sender.phone ? `Ph: ${data.sender.phone}` : "";
    case "storeName":
      return data.storeName;
    case "storePhone":
      return data.storePhone ? `Phone ${data.storePhone}` : "";
    case "storeWebsite":
      return data.storeWebsite;
    case "orderNumber":
      return data.orderNumber ? `Order ${data.orderNumber}` : "";
    case "shopifyOrderNumber":
      return data.shopifyOrderNumber ? `Shopify ${data.shopifyOrderNumber}` : "";
    case "subtotal":
      return `Subtotal  ${money(data.subtotal)}`;
    case "shipping":
      return `Shipping  ${money(data.shipping)}`;
    case "discount":
      return `Discount  ${money(data.discount)}`;
    case "total":
      return `Price  ${money(data.total)}`;
    case "codAmount":
      return codAmountLines(data.codAmount).join("\n");
    case "paymentMethod":
      return data.paymentMethod ? `Payment  ${data.paymentMethod}` : "";
    case "customerNote":
      return data.customerNote ? `Note  ${data.customerNote}` : "";
    case "promotionalMessage":
      return element?.content?.trim() || "";
    case "returnAddress":
      return data.returnAddress ? `Return to  ${data.returnAddress}` : "";
    case "returnPolicy":
      return element?.content?.trim() || "";
    case "customerSupport":
      return element?.content?.trim() || (data.storePhone ? `Support  ${data.storePhone}` : "");
    case "fromAddress":
      return ["From/ Return Address", data.sender.name, ...data.sender.lines, data.sender.phone ? `Ph: ${data.sender.phone}` : ""]
        .filter(Boolean)
        .join("\n");
    case "shipTo":
      return ["Ship To:", data.receiver.name, ...data.receiver.lines, data.receiver.phone ? `Mobile: ${data.receiver.phone}` : ""]
        .filter(Boolean)
        .join("\n");
    case "customerId":
      return customerIdLine(data.customerId);
    case "articleType":
      return articleContractLine(data.articleType, data.contractId);
    case "serviceContractId":
      return serviceContractLine(data.contractId);
    case "orderIdDate": {
      const order = data.orderNumber ? `Order ID: ${data.orderNumber}` : "";
      const date = data.orderDate ? `Date: ${data.orderDate}` : "";
      return [order, date].filter(Boolean).join(", ");
    }
    case "parcelSize":
      return parcelSizeLines(data, true).join("\n");
    case "prepaid":
      return "PRE PAID";
    case "labelBorder":
    case "indiaPostBarcode":
      return "";
    default:
      return "";
  }
}

function paymentModeOf(data: PackingLabelData) {
  return data.paymentMode || data.paymentMethod || "";
}

export function customBlockVisibility(template: LabelTemplate, data: PackingLabelData) {
  const cod = isCodPayment(paymentModeOf(data));
  const on = (id: string) => Boolean(template.elements[id]?.visible);
  return {
    barcode: on("indiaPostBarcode"),
    cod: on("codAmount") && cod,
    prepaid: on("prepaid") && !cod,
  };
}

function drawMultiline(
  page: PDFPage,
  font: PDFFont,
  text: string,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    align: "left" | "center" | "right";
    lineGap?: number;
    gap?: number;
  }
) {
  const box = insetTextBox(opts);
  const chunks = text.split("\n").flatMap((line) => wrapLines(font, line, opts.size, box.width));
  const lineHeight = opts.size + (opts.lineGap ?? 2);
  const maxLines = Math.max(1, Math.floor(box.height / lineHeight));
  chunks.slice(0, maxLines).forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, opts.size);
    let x = box.x;
    if (opts.align === "center") x = box.x + (box.width - width) / 2;
    if (opts.align === "right") x = box.x + box.width - width;
    const y = box.y + box.height - (index + 1) * lineHeight;
    if (y < box.y) return;
    page.drawText(line, { x: Math.max(0, x), y, size: opts.size, font, color: rgb(0.07, 0.09, 0.15) });
  });
}

function pickAddressFont(regular: PDFFont, bold: PDFFont, italic: PDFFont, boldItalic: PDFFont, run: { bold: boolean; italic: boolean }) {
  if (run.bold && run.italic) return boldItalic;
  if (run.bold) return bold;
  if (run.italic) return italic;
  return regular;
}

function drawAddressBlock(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont },
  element: TemplateElement,
  party: PackingParty,
  placed: { x: number; y: number; width: number; height: number },
  size: number,
  align: "left" | "center" | "right",
  headingText = "Ship To:"
) {
  const heading = element.addressLayout?.headingText?.trim() || headingText;
  const composed = composeAddressLines(element.addressLayout as AddressLayout | undefined, addressPartsFromParty(party), heading);
  const box = insetTextBox({ ...placed, gap: element.gap });
  const lineGap = composed.layout.lineGapMm > 0 ? mmToPt(composed.layout.lineGapMm) : (element.lineGap ?? 2);
  const lineHeight = size + lineGap;
  let top = box.y + box.height;
  const ink = rgb(0.07, 0.09, 0.15);
  const measure = (text: string, run: { bold: boolean }) => helveticaTextWidth(text, size, run.bold);
  const drawRuns = (runs: { text: string; bold: boolean; italic: boolean }[]) => {
    top -= lineHeight;
    if (top < box.y) return;
    const widths = runs.map((run) => pickAddressFont(fonts.regular, fonts.bold, fonts.italic, fonts.boldItalic, run).widthOfTextAtSize(run.text, size));
    const total = widths.reduce((sum, width) => sum + width, 0);
    let x = box.x;
    if (align === "center") x = box.x + Math.max(0, (box.width - total) / 2);
    if (align === "right") x = box.x + Math.max(0, box.width - total);
    runs.forEach((run, index) => {
      const font = pickAddressFont(fonts.regular, fonts.bold, fonts.italic, fonts.boldItalic, run);
      page.drawText(run.text, { x: Math.max(0, x), y: top, size, font, color: ink });
      x += widths[index] ?? 0;
    });
  };
  const wrappedHeading = composed.heading ? wrapAddressRuns([composed.heading], box.width, measure) : [];
  wrappedHeading.forEach((runs) => drawRuns(runs));
  const rule = mmToPt(composed.layout.separatorThicknessMm);
  if (composed.heading && rule > 0) {
    top -= Math.max(2, rule + 2);
    if (top >= box.y) {
      page.drawRectangle({
        x: box.x,
        y: top,
        width: box.width,
        height: rule,
        color: ink,
      });
    }
  }
  composed.lines.forEach((runs) => wrapAddressRuns(runs, box.width, measure).forEach((line) => drawRuns(line)));
}

async function drawIndiaPostBarcode(
  document: PDFDocument,
  page: PDFPage,
  element: TemplateElement,
  data: PackingLabelData,
  placed: { x: number; y: number; width: number; height: number },
  font: PDFFont
) {
  const article = (data.articleId ?? "").trim();
  const showText = element.showArticleText !== false;
  const size = element.fontSize ?? 10;
  const align = element.align ?? "center";
  if (!article) {
    drawMultiline(page, font, "India Post tracking number not available", {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      size,
      align,
      lineGap: element.lineGap,
      gap: element.gap,
    });
    return;
  }
  const png = await indiaPostBarcodePng(article);
  if (!png) {
    drawMultiline(page, font, "India Post tracking number not available", {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      size,
      align,
      lineGap: element.lineGap,
      gap: element.gap,
    });
    return;
  }
  const image = await document.embedPng(png);
  const caption = showText ? size + 6 : 0;
  const barHeight = Math.max(8, placed.height - caption);
  const scale = Math.min(placed.width / image.width, barHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  let x = placed.x;
  if (align === "center") x = placed.x + (placed.width - width) / 2;
  if (align === "right") x = placed.x + placed.width - width;
  page.drawImage(image, {
    x,
    y: placed.y + caption + Math.max(0, (barHeight - height) / 2),
    width,
    height,
  });
  if (!showText) return;
  drawMultiline(page, font, article, {
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: caption + 2,
    size,
    align,
    lineGap: element.lineGap,
    gap: element.gap,
  });
}

export async function drawMerchantFields(
  document: PDFDocument,
  page: PDFPage,
  template: LabelTemplate,
  data: PackingLabelData,
  opts?: { scaleX?: number; scaleY?: number }
) {
  const scaleX = opts?.scaleX ?? 1;
  const scaleY = opts?.scaleY ?? 1;
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await document.embedFont(StandardFonts.HelveticaBoldOblique);
  const box = (element: LabelTemplate["elements"][string]) => ({
    x: element.x * scaleX,
    y: element.y * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
  });

  const border = template.elements.labelBorder;
  if (border?.visible) {
    const placed = box(border);
    const stroke = Math.min(12, Math.max(0.5, border.borderWidth ?? 1)) * Math.min(scaleX, scaleY);
    const half = stroke / 2;
    const ink = rgb(0.07, 0.09, 0.15);
    page.drawRectangle({
      x: placed.x + half,
      y: placed.y + half,
      width: Math.max(0, placed.width - stroke),
      height: Math.max(0, placed.height - stroke),
      borderWidth: stroke,
      borderColor: ink,
    });
    for (const bar of horizontalLineBars(border, template.page.heightPt)) {
      page.drawRectangle({
        x: bar.x * scaleX,
        y: bar.y * scaleY,
        width: bar.width * scaleX,
        height: Math.max(0.25, bar.height * Math.min(scaleX, scaleY)),
        color: ink,
      });
    }
  }

  const logo = template.elements.merchantLogo;
  if (logo?.visible && data.logoBytes && data.logoMime) {
    const mime = data.logoMime.toLowerCase();
    const placed = box(logo);
    try {
      const image = mime.includes("png")
        ? await document.embedPng(data.logoBytes)
        : mime.includes("jpeg") || mime.includes("jpg")
          ? await document.embedJpg(data.logoBytes)
          : null;
      if (image) {
        const pad = Math.max(0, logo.gap ?? 0);
        const inner = insetTextBox({ ...placed, gap: pad });
        const scale = Math.min(inner.width / image.width, inner.height / image.height, 1);
        page.drawRectangle({
          x: placed.x,
          y: placed.y,
          width: placed.width,
          height: placed.height,
          color: rgb(1, 1, 1),
        });
        page.drawImage(image, {
          x: inner.x,
          y: inner.y,
          width: image.width * scale,
          height: image.height * scale,
        });
      }
    } catch {
      // Skip a bad logo rather than failing the label.
    }
  }

  const visibility = customBlockVisibility(template, data);
  const ids = [...MERCHANT_ELEMENT_IDS, ...customTextIds(template.elements).filter((id) => !(MERCHANT_ELEMENT_IDS as readonly string[]).includes(id))];
  for (const id of ids) {
    if (id === "merchantLogo" || id === "labelBorder") continue;
    const element = template.elements[id];
    if (!element?.visible) continue;
    if (id === "codAmount" && !visibility.cod) continue;
    if (id === "prepaid" && !visibility.prepaid) continue;
    if (id === "indiaPostBarcode" && !visibility.barcode) continue;
    const placed = box(element);
    const font = element.fontWeight === "bold" ? bold : regular;
    const size = (element.fontSize ?? 9) * Math.min(scaleX, scaleY);
    const align = element.align ?? "left";
    if (id === "indiaPostBarcode") {
      await drawIndiaPostBarcode(document, page, element, data, placed, font);
      continue;
    }
    page.drawRectangle({
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      color: rgb(1, 1, 1),
    });
    if (id === "products") {
      const includeTotal = !template.elements.total?.visible;
      const fitted = growAutoHeightBox(
        element,
        template.page,
        productTableHeight(element, data.items, { includeTotal, total: data.total })
      );
      const grown = box(fitted);
      page.drawRectangle({
        x: grown.x,
        y: grown.y,
        width: grown.width,
        height: grown.height,
        color: rgb(1, 1, 1),
      });
      drawProductTable(page, font, bold, fitted, data, grown, size, includeTotal);
      continue;
    }
    if (id === "codAmount") {
      const fitted = growAutoHeightBox(element, template.page, codBlockHeight(element, data.codAmount));
      const grown = box(fitted);
      page.drawRectangle({
        x: grown.x,
        y: grown.y,
        width: grown.width,
        height: grown.height,
        color: rgb(1, 1, 1),
      });
      drawMultiline(page, font, codAmountLines(data.codAmount).join("\n"), {
        x: grown.x,
        y: grown.y,
        width: grown.width,
        height: grown.height,
        size,
        align,
        lineGap: fitted.lineGap,
        gap: fitted.gap,
      });
      continue;
    }
    if (isCustomTextId(id)) {
      const text = element.content?.trim() || "";
      if (!text) continue;
      const fitted = growAutoHeightBox(element, template.page, customTextBlockHeight(element, text));
      const grown = box(fitted);
      page.drawRectangle({
        x: grown.x,
        y: grown.y,
        width: grown.width,
        height: grown.height,
        color: rgb(1, 1, 1),
      });
      drawMultiline(page, font, text, {
        x: grown.x,
        y: grown.y,
        width: grown.width,
        height: grown.height,
        size,
        align,
        lineGap: fitted.lineGap,
        gap: fitted.gap,
      });
      continue;
    }
    if (id === "shipTo" || id === "fromAddress") {
      const party = id === "shipTo" ? data.receiver : data.sender;
      const heading = id === "fromAddress" ? "From/ Return Address" : "Ship To:";
      const fitted = fitAddressBox(
        { ...element, addressLayout: element.addressLayout ?? undefined },
        template.page,
        addressPartsFromParty(party),
        element.addressLayout?.headingText?.trim() || heading
      );
      const grown = box(fitted);
      page.drawRectangle({
        x: grown.x,
        y: grown.y,
        width: grown.width,
        height: grown.height,
        color: rgb(1, 1, 1),
      });
      drawAddressBlock(page, { regular, bold, italic, boldItalic }, fitted, party, grown, size, align, heading);
      continue;
    }
    const text = valueFor(id, data, template);
    if (!text) continue;
    const drawText = text.includes("\n") ? drawMultiline : drawWrapped;
    drawText(page, font, text, {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      size,
      align,
      lineGap: element.lineGap,
      gap: element.gap,
    });
  }

  const pageSize = page.getSize();
  const markSize = LABEL_GENERATED_FROM_SIZE * Math.min(scaleX, scaleY);
  const markWidth = regular.widthOfTextAtSize(LABEL_GENERATED_FROM, markSize);
  page.drawText(LABEL_GENERATED_FROM, {
    x: Math.max(2, (pageSize.width - markWidth) / 2),
    y: pageSize.height - markSize - 3 * Math.min(scaleX, scaleY),
    size: markSize,
    font: regular,
    color: rgb(0.28, 0.3, 0.34),
  });
}

export async function renderMerchantLabelPdf(templateInput: unknown, data: PackingLabelData) {
  const template = parseLabelTemplate(templateInput);
  const pageSize = labelPageSize(template.page);
  const width = pageSize.widthPt > 0 ? pageSize.widthPt : pagePreset(template.page.paperSize).widthPt;
  const height = pageSize.heightPt > 0 ? pageSize.heightPt : pagePreset(template.page.paperSize).heightPt;
  const document = await PDFDocument.create();
  const page = document.addPage([width, height]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(1, 1, 1),
  });
  await drawMerchantFields(document, page, template, data);
  return document.save();
}

function drawRight(
  page: PDFPage,
  font: PDFFont,
  text: string,
  xRight: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: xRight - width, y, size, font, color });
}

function partyLines(party: PackingParty) {
  return [party.name, ...party.lines, party.phone ? `Ph: ${party.phone}` : ""].filter(Boolean);
}

export async function renderPackingSlipPdf(data: PackingLabelData) {
  const document = await PDFDocument.create();
  const page = document.addPage([SLIP_WIDTH, SLIP_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.4, 0.4, 0.45);
  const rule = rgb(0.12, 0.12, 0.14);
  const hairline = rgb(0.82, 0.82, 0.84);

  page.drawRectangle({ x: 0, y: 0, width: SLIP_WIDTH, height: SLIP_HEIGHT, color: rgb(1, 1, 1) });

  const contentRight = SLIP_WIDTH - SLIP_MARGIN;
  let y = SLIP_HEIGHT - SLIP_MARGIN;

  let logoWidth = 0;
  if (data.logoBytes && data.logoMime) {
    const mime = data.logoMime.toLowerCase();
    try {
      const image = mime.includes("png")
        ? await document.embedPng(data.logoBytes)
        : mime.includes("jpeg") || mime.includes("jpg")
          ? await document.embedJpg(data.logoBytes)
          : null;
      if (image) {
        const height = 36;
        const scale = Math.min(height / image.height, 120 / image.width);
        logoWidth = image.width * scale + 12;
        page.drawImage(image, {
          x: SLIP_MARGIN,
          y: y - height + 8,
          width: image.width * scale,
          height: image.height * scale,
        });
      }
    } catch {
      // Skip a broken logo; the packing slip still prints.
    }
  }

  const storeTitle = (data.storeName || data.sender.name || "Store").toUpperCase();
  page.drawText(storeTitle, {
    x: SLIP_MARGIN + logoWidth,
    y,
    size: 18,
    font: bold,
    color: ink,
  });

  const orderLabel = data.orderNumber ? `Order ${data.orderNumber}` : data.shopifyOrderNumber ? `Order #${data.shopifyOrderNumber}` : "";
  if (orderLabel) {
    drawRight(page, regular, orderLabel, contentRight, y + 4, 10, ink);
  }
  if (data.orderDate) {
    drawRight(page, regular, data.orderDate, contentRight, y - 10, 9, muted);
  }

  y -= 28;
  page.drawLine({
    start: { x: SLIP_MARGIN, y },
    end: { x: contentRight, y },
    thickness: 1.1,
    color: rule,
  });

  y -= 22;
  const colWidth = (SLIP_WIDTH - SLIP_MARGIN * 2 - 24) / 2;
  const ship = data.receiver;
  const from = data.sender;

  const drawAddressBlock = (title: string, party: PackingParty, x: number, top: number) => {
    page.drawText(title, { x, y: top, size: 8, font: bold, color: muted });
    let cursor = top - 14;
    for (const line of partyLines(party)) {
      const wrapped = wrapLines(regular, line, 9, colWidth);
      for (const part of wrapped) {
        page.drawText(part, { x, y: cursor, size: 9, font: regular, color: ink });
        cursor -= 12;
      }
    }
    return cursor;
  };

  const shipBottom = drawAddressBlock("SHIP TO", ship, SLIP_MARGIN, y);
  const fromBottom = drawAddressBlock("FROM", from, SLIP_MARGIN + colWidth + 24, y);
  y = Math.min(shipBottom, fromBottom) - 16;

  page.drawLine({
    start: { x: SLIP_MARGIN, y },
    end: { x: contentRight, y },
    thickness: 1.1,
    color: rule,
  });

  y -= 18;
  page.drawText("ITEM", { x: SLIP_MARGIN, y, size: 8, font: bold, color: muted });
  page.drawText("QTY", { x: SLIP_MARGIN + 318, y, size: 8, font: bold, color: muted });
  page.drawText("PRICE", { x: SLIP_MARGIN + 372, y, size: 8, font: bold, color: muted });
  drawRight(page, bold, "TOTAL", contentRight, y, 8, muted);

  y -= 8;
  page.drawLine({
    start: { x: SLIP_MARGIN, y },
    end: { x: contentRight, y },
    thickness: 0.6,
    color: hairline,
  });
  y -= 14;

  const items = data.items.length ? data.items : [{ title: "No line items", sku: null, quantity: 0, unitPrice: 0 }];
  for (const item of items) {
    const productName = packingItemName(item);
    const titleLines = wrapLines(bold, productName, 10, 300);
    const sku = item.sku?.trim();
    const rowHeight = titleLines.length * 13 + (sku ? 11 : 0) + 10;
    if (y - rowHeight < 120) break;

    let textY = y;
    titleLines.forEach((line) => {
      page.drawText(line, { x: SLIP_MARGIN, y: textY, size: 10, font: bold, color: ink });
      textY -= 13;
    });
    if (sku && sku.toLowerCase() !== productName.toLowerCase()) {
      page.drawText(`SKU: ${sku}`, { x: SLIP_MARGIN, y: textY, size: 8, font: regular, color: muted });
    }

    const qty = item.quantity > 0 ? String(item.quantity) : "—";
    page.drawText(qty, { x: SLIP_MARGIN + 318, y, size: 10, font: regular, color: ink });
    page.drawText(money(item.unitPrice), { x: SLIP_MARGIN + 372, y, size: 10, font: regular, color: ink });
    drawRight(page, regular, money(item.unitPrice * item.quantity), contentRight, y, 10, ink);

    y -= rowHeight;
    page.drawLine({
      start: { x: SLIP_MARGIN, y: y + 6 },
      end: { x: contentRight, y: y + 6 },
      thickness: 0.5,
      color: hairline,
    });
  }

  y -= 8;
  const totals: Array<[string, number, boolean]> = [
    ["Subtotal", data.subtotal, false],
    ...(data.shipping ? [["Shipping", data.shipping, false] as [string, number, boolean]] : []),
    ...(data.discount ? [["Discount", data.discount, false] as [string, number, boolean]] : []),
    ["Total", data.total, true],
    ...(data.codAmount ? [["COD", data.codAmount, false] as [string, number, boolean]] : []),
  ];
  for (const [label, amount, strong] of totals) {
    const font = strong ? bold : regular;
    const size = strong ? 11 : 10;
    page.drawText(label, { x: SLIP_MARGIN + 318, y, size, font, color: ink });
    drawRight(page, font, money(amount), contentRight, y, size, ink);
    y -= strong ? 18 : 15;
  }

  if (data.paymentMethod) {
    page.drawText(`Payment  ${data.paymentMethod}`, { x: SLIP_MARGIN + 318, y, size: 9, font: regular, color: muted });
    y -= 18;
  }

  if (data.customerNote.trim()) {
    y -= 8;
    page.drawLine({
      start: { x: SLIP_MARGIN, y },
      end: { x: contentRight, y },
      thickness: 1.1,
      color: rule,
    });
    y -= 20;
    page.drawText("NOTES", { x: SLIP_MARGIN, y, size: 8, font: bold, color: muted });
    y -= 14;
    for (const line of wrapLines(regular, data.customerNote, 9, SLIP_WIDTH - SLIP_MARGIN * 2)) {
      page.drawText(line, { x: SLIP_MARGIN, y, size: 9, font: regular, color: ink });
      y -= 12;
    }
  }

  const footerY = 56;
  page.drawText("Thank you for shopping with us!", {
    x: (SLIP_WIDTH - bold.widthOfTextAtSize("Thank you for shopping with us!", 10)) / 2,
    y: footerY + 28,
    size: 10,
    font: bold,
    color: ink,
  });
  const footerLines = [
    data.storeName || data.sender.name,
    data.sender.lines.join(", "),
    [data.storePhone ? `Phone ${data.storePhone}` : "", data.storeWebsite].filter(Boolean).join("  ·  "),
  ].filter(Boolean);
  footerLines.forEach((line, index) => {
    const size = index === 0 ? 9 : 8;
    const font = index === 0 ? bold : regular;
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: (SLIP_WIDTH - width) / 2,
      y: footerY + 12 - index * 11,
      size,
      font,
      color: muted,
    });
  });

  return document.save();
}
