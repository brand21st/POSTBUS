import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { InvoiceAppearance } from "@/modules/invoices/schema";
import { parseInvoiceAppearance, readableTextOn } from "@/modules/invoices/schema";
import type { InvoiceViewModel } from "@/modules/invoices/data";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;

function hexRgb(hex: string): RGB {
  const value = hex.replace("#", "");
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  );
}

function money(value: number, currency = "INR") {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "INR" ? `Rs ${formatted}` : `${currency} ${formatted}`;
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        let chunk = "";
        for (const char of word) {
          const trial = chunk + char;
          if (font.widthOfTextAtSize(trial, size) <= maxWidth) chunk = trial;
          else {
            if (chunk) lines.push(chunk);
            chunk = char;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

const CODE128_PATTERNS = [
  "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110","10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100","11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000","10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110","10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000","11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100","10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110","10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000","11010011100","11000111010",
];

function code128B(text: string) {
  const chars = [...text].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126 ? code - 32 : 0;
  });
  let checksum = 104;
  chars.forEach((value, index) => {
    checksum += value * (index + 1);
  });
  checksum %= 103;
  const codes = [104, ...chars, checksum, 106];
  return codes.map((code) => CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0]).join("");
}

function drawBarcode(page: PDFPage, value: string, x: number, y: number, width: number, height: number) {
  const pattern = code128B(value);
  const moduleWidth = width / pattern.length;
  let cursor = x;
  for (const bit of pattern) {
    if (bit === "1") {
      page.drawRectangle({
        x: cursor,
        y,
        width: Math.max(moduleWidth, 0.4),
        height,
        color: rgb(0, 0, 0),
      });
    }
    cursor += moduleWidth;
  }
}

function drawRight(page: PDFPage, font: PDFFont, text: string, xRight: number, y: number, size: number, color: RGB) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: xRight - width, y, size, font, color });
}

export async function renderInvoicePdf(data: InvoiceViewModel) {
  const appearance: InvoiceAppearance = parseInvoiceAppearance(data.appearance);
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const text = hexRgb(appearance.textColor);
  const primary = hexRgb(appearance.primaryColor);
  const secondary = hexRgb(appearance.secondaryColor);
  const accent = hexRgb(appearance.accentColor);
  const border = hexRgb(appearance.borderColor);
  const headerBg = hexRgb(appearance.tableHeaderColor);
  const headerText = hexRgb(readableTextOn(appearance.tableHeaderColor));
  const totalBg = hexRgb(appearance.totalHighlightColor);
  const totalText = hexRgb(readableTextOn(appearance.totalHighlightColor));
  const muted = rgb(0.35, 0.38, 0.42);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: primary });

  let y = PAGE_HEIGHT - 36;
  page.drawText("INVOICE", { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize("INVOICE", 18), y, size: 18, font: bold, color: primary });

  y = PAGE_HEIGHT - 52;
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
        const scale = height / image.height;
        logoWidth = image.width * scale + 10;
        page.drawImage(image, { x: MARGIN, y: y - 8, width: image.width * scale, height });
      }
    } catch {
      // Skip a broken logo; the invoice still prints.
    }
  }

  page.drawText(data.storeName || "Store", { x: MARGIN + logoWidth, y, size: 13, font: bold, color: text });
  let infoY = y - 14;
  for (const line of [
    data.storeAddress.join(", "),
    data.storePhone ? `Phone ${data.storePhone}` : "",
    data.storeEmail,
    data.storeWebsite,
    data.storeGstin ? `GSTIN ${data.storeGstin}` : "",
  ].filter(Boolean)) {
    page.drawText(line, { x: MARGIN + logoWidth, y: infoY, size: 8, font: regular, color: muted });
    infoY -= 11;
  }

  y = Math.min(infoY, PAGE_HEIGHT - 110) - 8;
  page.drawRectangle({ x: MARGIN, y: y - 54, width: PAGE_WIDTH - MARGIN * 2, height: 62, color: secondary, borderColor: border, borderWidth: 0.6 });

  const meta = [
    ["Invoice No", data.invoiceNumber],
    ["Invoice Date", data.invoiceDate],
    ["Order No", data.orderNumber],
    ["Order Date", data.orderDate],
    ["Shipment ID", data.shipmentId && data.shipmentId !== "sample" ? data.shipmentId : ""],
    ["Payment", `${data.paymentMethod}${data.paymentStatus && data.paymentStatus !== data.paymentMethod ? ` · ${data.paymentStatus}` : ""}`],
  ].filter(([, value]) => value);
  meta.forEach((pair, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = MARGIN + 10 + col * 170;
    const rowY = y - 10 - row * 24;
    page.drawText(pair[0], { x, y: rowY, size: 7, font: regular, color: muted });
    page.drawText(pair[1], { x, y: rowY - 11, size: 9, font: bold, color: text });
  });

  y -= 78;
  if (data.trackingNumber) {
    page.drawText("Tracking ID", { x: MARGIN, y, size: 8, font: regular, color: muted });
    page.drawText(data.trackingNumber, { x: MARGIN, y: y - 16, size: 14, font: bold, color: accent });
    drawBarcode(page, data.trackingNumber, PAGE_WIDTH - MARGIN - 180, y - 22, 180, 28);
    y -= 42;
  }

  const boxWidth = (PAGE_WIDTH - MARGIN * 2 - 12) / 2;
  const drawParty = (title: string, party: InvoiceViewModel["billing"], x: number, top: number) => {
    page.drawText(title, { x, y: top, size: 8, font: bold, color: primary });
    let cursor = top - 14;
    const lines = [party.name, ...party.lines, party.phone, party.email].filter(Boolean);
    for (const line of lines) {
      const wrapped = wrapLines(regular, line, 8, boxWidth - 4);
      for (const part of wrapped) {
        page.drawText(part, { x, y: cursor, size: 8, font: regular, color: text });
        cursor -= 11;
      }
    }
    return cursor;
  };
  const billBottom = drawParty("BILL TO", data.billing.name ? data.billing : data.customer, MARGIN, y);
  const shipBottom = drawParty("SHIP TO", data.shipping.name ? data.shipping : data.customer, MARGIN + boxWidth + 12, y);
  y = Math.min(billBottom, shipBottom) - 16;

  const tableLeft = MARGIN;
  const tableWidth = PAGE_WIDTH - MARGIN * 2;
  const cols = { product: tableLeft + 8, qty: tableLeft + 330, price: tableLeft + 400, total: tableLeft + tableWidth - 8 };
  page.drawRectangle({ x: tableLeft, y: y - 18, width: tableWidth, height: 22, color: headerBg });
  page.drawText("PRODUCT", { x: cols.product, y: y - 12, size: 8, font: bold, color: headerText });
  page.drawText("QTY", { x: cols.qty, y: y - 12, size: 8, font: bold, color: headerText });
  page.drawText("PRICE", { x: cols.price, y: y - 12, size: 8, font: bold, color: headerText });
  drawRight(page, bold, "TOTAL", cols.total, y - 12, 8, headerText);
  y -= 28;

  const items = data.items.length ? data.items : [];
  for (const item of items) {
    const nameLines = wrapLines(regular, item.title, 9, 250);
    const skuLines = item.sku ? wrapLines(regular, `SKU ${item.sku}`, 7, 250) : [];
    const rowHeight = Math.max(18, nameLines.length * 11 + skuLines.length * 9 + 8);
    if (y - rowHeight < 90) {
      page.drawText("Continued on next page is not used; extra rows stay on this page.", { x: tableLeft, y: 70, size: 7, font: regular, color: muted });
    }
    page.drawLine({ start: { x: tableLeft, y }, end: { x: tableLeft + tableWidth, y }, thickness: 0.4, color: border });
    let textY = y - 12;
    nameLines.forEach((line) => {
      page.drawText(line, { x: cols.product, y: textY, size: 9, font: regular, color: text });
      textY -= 11;
    });
    skuLines.forEach((line) => {
      page.drawText(line, { x: cols.product, y: textY, size: 7, font: regular, color: muted });
      textY -= 9;
    });
    page.drawText(String(item.quantity), { x: cols.qty, y: y - 12, size: 9, font: regular, color: text });
    page.drawText(money(item.unitPrice, data.currency), { x: cols.price, y: y - 12, size: 9, font: regular, color: text });
    drawRight(page, regular, money(item.lineTotal, data.currency), cols.total, y - 12, 9, text);
    y -= rowHeight;
  }

  y -= 8;
  const totals: Array<[string, number, boolean]> = [
    ["Subtotal", data.subtotal, false],
    ...(data.discount ? [["Discount", data.discount, false] as [string, number, boolean]] : []),
    ...(data.shippingAmount ? [["Shipping", data.shippingAmount, false] as [string, number, boolean]] : []),
    ...(data.taxAmount ? [["Tax", data.taxAmount, false] as [string, number, boolean]] : []),
    ["TOTAL", data.total, true],
    ...(data.codAmount != null ? [["COD amount", data.codAmount, false] as [string, number, boolean]] : []),
  ];

  for (const [label, amount, highlight] of totals) {
    if (highlight) {
      page.drawRectangle({ x: tableLeft + tableWidth - 220, y: y - 6, width: 220, height: 22, color: totalBg });
      page.drawText(label, { x: tableLeft + tableWidth - 210, y: y, size: 10, font: bold, color: totalText });
      drawRight(page, bold, money(amount, data.currency), cols.total, y, 10, totalText);
      y -= 28;
    } else {
      page.drawText(label, { x: tableLeft + tableWidth - 210, y, size: 9, font: regular, color: muted });
      drawRight(page, regular, money(amount, data.currency), cols.total, y, 9, text);
      y -= 16;
    }
  }

  page.drawText("Generated by PostBus", { x: MARGIN, y: 28, size: 8, font: regular, color: muted });
  return document.save();
}

export function invoicePdfFilename(invoiceNumber: string) {
  return `${invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf`;
}
