import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pagePreset } from "@/modules/labels/page-presets";
import {
  MERCHANT_ELEMENT_IDS,
  parseLabelTemplate,
  type LabelTemplate,
  type MerchantElementId,
} from "@/modules/labels/template-schema";

export type PackingLineItem = {
  title: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
};

export type PackingParty = {
  name: string;
  phone: string;
  lines: string[];
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
};

const SLIP_WIDTH = 595.28;
const SLIP_HEIGHT = 841.89;
const SLIP_MARGIN = 48;

function money(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  opts: { x: number; y: number; width: number; height: number; size: number; align: "left" | "center" | "right" }
) {
  const lines = wrapLines(font, text, opts.size, opts.width);
  const lineHeight = opts.size + 2;
  const maxLines = Math.max(1, Math.floor(opts.height / lineHeight));
  const shown = lines.slice(0, maxLines);
  shown.forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, opts.size);
    let x = opts.x;
    if (opts.align === "center") x = opts.x + (opts.width - width) / 2;
    if (opts.align === "right") x = opts.x + opts.width - width;
    const y = opts.y + opts.height - (index + 1) * lineHeight;
    if (y < opts.y) return;
    page.drawText(line, { x: Math.max(0, x), y, size: opts.size, font, color: rgb(0.07, 0.09, 0.15) });
  });
}

function productLines(data: PackingLabelData, element: LabelTemplate["elements"][string]) {
  const showName = element.showName !== false;
  const showSku = Boolean(element.showSku);
  const showQty = element.showQuantity !== false;
  const showPrice = element.showPrice !== false;
  return data.items.map((item) => {
    const parts: string[] = [];
    if (showName) parts.push(item.title);
    if (showSku && item.sku) parts.push(`SKU ${item.sku}`);
    if (showQty) parts.push(`Qty: ${item.quantity}`);
    if (showPrice) parts.push(money(item.unitPrice * item.quantity));
    return parts.join("   ");
  });
}

function valueFor(id: MerchantElementId, data: PackingLabelData, template: LabelTemplate) {
  const element = template.elements[id];
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
      return `COD  ${money(data.codAmount)}`;
    case "paymentMethod":
      return data.paymentMethod ? `Payment  ${data.paymentMethod}` : "";
    case "customerNote":
      return data.customerNote ? `Note  ${data.customerNote}` : "";
    case "customText":
      return element?.content?.trim() || "";
    case "promotionalMessage":
      return element?.content?.trim() || "";
    case "returnAddress":
      return data.returnAddress ? `Return to  ${data.returnAddress}` : "";
    case "returnPolicy":
      return element?.content?.trim() || "";
    case "customerSupport":
      return element?.content?.trim() || (data.storePhone ? `Support  ${data.storePhone}` : "");
    default:
      return "";
  }
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
  const box = (element: LabelTemplate["elements"][string]) => ({
    x: element.x * scaleX,
    y: element.y * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
  });

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
        const scale = Math.min(placed.width / image.width, placed.height / image.height, 1);
        page.drawRectangle({
          x: placed.x,
          y: placed.y,
          width: placed.width,
          height: placed.height,
          color: rgb(1, 1, 1),
        });
        page.drawImage(image, {
          x: placed.x,
          y: placed.y,
          width: image.width * scale,
          height: image.height * scale,
        });
      }
    } catch {
      // Skip a bad logo rather than failing the label.
    }
  }

  for (const id of MERCHANT_ELEMENT_IDS) {
    if (id === "merchantLogo") continue;
    const element = template.elements[id];
    if (!element?.visible) continue;
    const placed = box(element);
    const font = element.fontWeight === "bold" ? bold : regular;
    const size = (element.fontSize ?? 9) * Math.min(scaleX, scaleY);
    const align = element.align ?? "left";
    page.drawRectangle({
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      color: rgb(1, 1, 1),
    });
    if (id === "products") {
      const lines = productLines(data, element);
      let cursor = placed.y + placed.height - (size + 2);
      for (const line of lines) {
        if (cursor < placed.y) break;
        const wrapped = wrapLines(font, line, size, placed.width);
        for (const part of wrapped) {
          if (cursor < placed.y) break;
          page.drawText(part, { x: placed.x, y: cursor, size, font, color: rgb(0.07, 0.09, 0.15) });
          cursor -= size + 2;
        }
      }
      continue;
    }
    const text = valueFor(id, data, template);
    if (!text) continue;
    drawWrapped(page, font, text, {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      size,
      align,
    });
  }
}

export async function renderMerchantLabelPdf(templateInput: unknown, data: PackingLabelData) {
  const template = parseLabelTemplate(templateInput);
  const pageSize = pagePreset(template.page.paperSize);
  const document = await PDFDocument.create();
  const page = document.addPage([pageSize.widthPt, pageSize.heightPt]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageSize.widthPt,
    height: pageSize.heightPt,
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
  page.drawText("ITEMS", { x: SLIP_MARGIN, y, size: 8, font: bold, color: muted });
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
    const titleLines = wrapLines(regular, item.title || "Item", 10, 300);
    const sku = item.sku?.trim();
    const rowHeight = titleLines.length * 13 + (sku ? 11 : 0) + 10;
    if (y - rowHeight < 120) break;

    let textY = y;
    titleLines.forEach((line, index) => {
      page.drawText(line, { x: SLIP_MARGIN, y: textY, size: 10, font: index === 0 ? regular : regular, color: ink });
      textY -= 13;
    });
    if (sku) {
      page.drawText(sku, { x: SLIP_MARGIN, y: textY, size: 8, font: regular, color: muted });
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
