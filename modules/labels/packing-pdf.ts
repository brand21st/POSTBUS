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

export type PackingLabelData = {
  storeName: string;
  storePhone: string;
  storeWebsite: string;
  orderNumber: string;
  shopifyOrderNumber: string;
  items: PackingLineItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  codAmount: number;
  paymentMethod: string;
  customerNote: string;
  returnAddress: string;
  logoBytes?: Uint8Array | null;
  logoMime?: string | null;
};

function money(value: number) {
  return `Rs ${value.toFixed(2)}`;
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
      return `Total  ${money(data.total)}`;
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

export async function renderMerchantLabelPdf(templateInput: unknown, data: PackingLabelData) {
  const template = parseLabelTemplate(templateInput);
  const pageSize = pagePreset(template.page.paperSize);
  const document = await PDFDocument.create();
  const page = document.addPage([pageSize.widthPt, pageSize.heightPt]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageSize.widthPt,
    height: pageSize.heightPt,
    color: rgb(1, 1, 1),
  });
  page.drawText("Merchant packing label", {
    x: 16,
    y: pageSize.heightPt - 12,
    size: 7,
    font: regular,
    color: rgb(0.45, 0.47, 0.52),
  });

  const logo = template.elements.merchantLogo;
  if (logo?.visible && data.logoBytes && data.logoMime) {
    const mime = data.logoMime.toLowerCase();
    try {
      const image = mime.includes("png")
        ? await document.embedPng(data.logoBytes)
        : mime.includes("jpeg") || mime.includes("jpg")
          ? await document.embedJpg(data.logoBytes)
          : null;
      if (image) {
        const scale = Math.min(logo.width / image.width, logo.height / image.height, 1);
        page.drawImage(image, {
          x: logo.x,
          y: logo.y,
          width: image.width * scale,
          height: image.height * scale,
        });
      }
    } catch {
      // Skip a bad logo rather than failing the packing PDF.
    }
  }

  for (const id of MERCHANT_ELEMENT_IDS) {
    if (id === "merchantLogo") continue;
    const element = template.elements[id];
    if (!element?.visible) continue;
    const font = element.fontWeight === "bold" ? bold : regular;
    const size = element.fontSize ?? 9;
    const align = element.align ?? "left";
    if (id === "products") {
      const lines = productLines(data, element);
      let cursor = element.y + element.height - (size + 2);
      for (const line of lines) {
        if (cursor < element.y) break;
        const wrapped = wrapLines(font, line, size, element.width);
        for (const part of wrapped) {
          if (cursor < element.y) break;
          page.drawText(part, { x: element.x, y: cursor, size, font, color: rgb(0.07, 0.09, 0.15) });
          cursor -= size + 2;
        }
      }
      continue;
    }
    const text = valueFor(id, data, template);
    if (!text) continue;
    drawWrapped(page, font, text, {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      size,
      align,
    });
  }

  return document.save();
}
