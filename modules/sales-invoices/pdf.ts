import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { drawPaintedText, wrapPaintText } from "@/modules/labels/unicode/paint";
import type { SalesInvoiceSettings, SalesInvoiceRecord } from "@/modules/sales-invoices/service";
import { paiseInWords } from "@/modules/sales-invoices/tax";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;

function inr(paise: number) {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}Rs ${rupees}.${frac}`;
}

function wrap(text: string, size: number, width: number) {
  return wrapPaintText(String(text || ""), width, size, "normal");
}

async function paint(document: PDFDocument, page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color: RGB, bold = false) {
  return drawPaintedText(document, page, { text, x, y, size, font, color, bold });
}

function titleFor(invoice: SalesInvoiceRecord) {
  if (invoice.documentKind === "CREDIT_NOTE") return "CREDIT NOTE";
  if (invoice.documentType === "TAX_INVOICE") return "TAX INVOICE";
  if (invoice.documentType === "BILL_OF_SUPPLY") return "BILL OF SUPPLY";
  return "INVOICE";
}

export async function renderSalesInvoicePdf(input: {
  invoice: SalesInvoiceRecord;
  settings: SalesInvoiceSettings;
  logo: Uint8Array | null;
  logoMime: string | null;
}) {
  const { invoice, settings } = input;
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.14, 0.16);
  const muted = rgb(0.35, 0.38, 0.42);
  const line = rgb(0.82, 0.84, 0.86);
  const brand = rgb(0, 0.48, 0.3);
  const pages: PDFPage[] = [];
  const newPage = () => {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    return page;
  };
  let page = newPage();
  let y = PAGE_HEIGHT - MARGIN;

  const ensure = (height: number) => {
    if (y - height < 64) {
      page = newPage();
      y = PAGE_HEIGHT - MARGIN;
      drawTableHeader();
    }
  };

  const sellerName = invoice.seller.legalName || invoice.seller.tradeName || "Store";
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: brand });
  y = PAGE_HEIGHT - 40;
  if (input.logo && input.logoMime) {
    try {
      const image = input.logoMime.includes("png")
        ? await document.embedPng(input.logo)
        : input.logoMime.includes("jpeg") || input.logoMime.includes("jpg")
          ? await document.embedJpg(input.logo)
          : null;
      if (image) {
        const height = 32;
        const scale = height / image.height;
        page.drawImage(image, { x: MARGIN, y: y - 8, width: image.width * scale, height });
      }
    } catch {
      // A broken logo does not block the invoice.
    }
  }
  await paint(document, page, bold, sellerName, MARGIN + 120, y, 13, ink, true);
  const heading = titleFor(invoice);
  page.drawText(heading, {
    x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(heading, 14),
    y,
    size: 14,
    font: bold,
    color: brand,
  });
  y -= 16;
  const sellerLines = [
    [invoice.seller.line1, invoice.seller.line2].filter(Boolean).join(", "),
    [invoice.seller.city, invoice.seller.state, invoice.seller.pincode].filter(Boolean).join(", "),
    invoice.seller.phone ? `Phone ${invoice.seller.phone}` : "",
    invoice.seller.email,
    invoice.seller.website,
    invoice.seller.scheme === "REGULAR" && invoice.seller.gstin ? `GSTIN ${invoice.seller.gstin}` : "",
  ].filter(Boolean);
  for (const row of sellerLines) {
    await paint(document, page, regular, row, MARGIN + 120, y, 8, muted);
    y -= 11;
  }

  y -= 8;
  const meta = [
    ["Invoice No", invoice.invoiceNumber || "Draft"],
    ["Invoice Date", invoice.invoiceDate || ""],
    settings.showOrderNumber ? ["Order No", invoice.orderNumber] : null,
    ["Payment", settings.showPaymentMethod ? invoice.paymentMethod : ""],
    invoice.documentType === "TAX_INVOICE" ? ["Place of supply", `${invoice.posStateName || ""} ${invoice.posStateCode || ""}`.trim()] : null,
    invoice.documentType === "TAX_INVOICE" ? ["State code", invoice.posStateCode || ""] : null,
    invoice.financialYear ? ["Financial year", invoice.financialYear] : null,
  ].filter((pair): pair is [string, string] => Boolean(pair && pair[1]));
  meta.forEach((pair, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = MARGIN + col * 175;
    page.drawText(pair[0], { x, y: y - row * 22, size: 7, font: regular, color: muted });
    page.drawText(pair[1], { x, y: y - 11 - row * 22, size: 9, font: bold, color: ink });
  });
  y -= Math.ceil(meta.length / 3) * 24 + 16;

  const drawParty = async (label: string, party: SalesInvoiceRecord["billing"], x: number) => {
    page.drawText(label, { x, y, size: 8, font: bold, color: brand });
    let cursor = y - 12;
    const rows = [party.name, party.company, party.line1, party.line2, [party.city, party.state, party.pincode].filter(Boolean).join(", "), party.phone, party.email, party.gstin ? `GSTIN ${party.gstin}` : ""].filter(Boolean);
    for (const row of rows) {
      const parts = wrap(row, 8, 240);
      for (const part of parts) {
        await paint(document, page, regular, part, x, cursor, 8, ink);
        cursor -= 11;
      }
    }
    return cursor;
  };
  const left = await drawParty("BILL TO", invoice.billing, MARGIN);
  const right = settings.showShippingAddress ? await drawParty("SHIP TO", invoice.shipping, MARGIN + 270) : y;
  y = Math.min(left, right) - 16;

  const gstTemplate = settings.template === "GST" || invoice.documentType === "TAX_INVOICE";
  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 16, width: PAGE_WIDTH - MARGIN * 2, height: 18, color: brand });
    page.drawText("PRODUCT", { x: MARGIN + 6, y: y - 11, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText("QTY", { x: 330, y: y - 11, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText("PRICE", { x: 380, y: y - 11, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText("TOTAL", { x: 500, y: y - 11, size: 8, font: bold, color: rgb(1, 1, 1) });
    y -= 24;
  };
  drawTableHeader();

  for (const item of invoice.lines) {
    const details = [
      settings.showVariant && item.variant ? item.variant : "",
      settings.showSku && item.sku ? `SKU ${item.sku}` : "",
      (gstTemplate || settings.showHsn) && item.hsn ? `HSN ${item.hsn}` : "",
    ].filter(Boolean);
    const nameLines = wrap(item.name, 9, 250);
    const detailLines = details.flatMap((detail) => wrap(detail, 7, 250));
    const rowHeight = nameLines.length * 11 + detailLines.length * 9 + 8;
    ensure(rowHeight + 8);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.3, color: line });
    let textY = y - 12;
    for (const row of nameLines) {
      await paint(document, page, regular, row, MARGIN + 6, textY, 9, ink);
      textY -= 11;
    }
    for (const row of detailLines) {
      await paint(document, page, regular, row, MARGIN + 6, textY, 7, muted);
      textY -= 9;
    }
    page.drawText(String(item.quantity), { x: 330, y: y - 12, size: 9, font: regular, color: ink });
    page.drawText(inr(item.unitPricePaise), { x: 370, y: y - 12, size: 8, font: regular, color: ink });
    page.drawText(inr(item.lineTotalPaise), { x: 490, y: y - 12, size: 8, font: bold, color: ink });
    y -= rowHeight;
  }

  ensure(140);
  y -= 12;
  const shippingLabel = invoice.shippingPaise === 0 ? "Free Delivery" : inr(invoice.shippingPaise);
  const totals: Array<[string, string]> = [
    ["Subtotal", inr(invoice.subtotalPaise)],
    ...(invoice.discountPaise ? [["Discount", inr(-Math.abs(invoice.discountPaise))] as [string, string]] : []),
    ["Shipping", shippingLabel],
    ["TOTAL", inr(invoice.grandTotalPaise)],
  ];
  for (const [label, value] of totals) {
    const strong = label === "TOTAL";
    page.drawText(label, { x: 360, y, size: strong ? 11 : 9, font: strong ? bold : regular, color: strong ? ink : muted });
    page.drawText(value, { x: 470, y, size: strong ? 11 : 9, font: bold, color: ink });
    y -= strong ? 18 : 14;
  }
  if (invoice.pricing === "INCLUSIVE" || invoice.cgstPaise || invoice.sgstPaise || invoice.utgstPaise || invoice.igstPaise) {
    page.drawText(invoice.pricing === "INCLUSIVE" ? "Includes" : "Tax", { x: 360, y, size: 8, font: regular, color: muted });
    y -= 12;
    for (const [label, amount] of [
      ["CGST", invoice.cgstPaise],
      ["SGST", invoice.sgstPaise],
      ["UTGST", invoice.utgstPaise],
      ["IGST", invoice.igstPaise],
    ] as const) {
      if (!amount) continue;
      page.drawText(`${label} ${inr(amount)}`, { x: 360, y, size: 8, font: regular, color: ink });
      y -= 11;
    }
  }
  if (invoice.codCollectPaise) {
    page.drawText(`COD to collect ${inr(invoice.codCollectPaise)}`, { x: 360, y, size: 8, font: regular, color: muted });
    y -= 12;
  }
  ensure(70);
  if (gstTemplate) {
    await paint(document, page, regular, `Amount in words: ${paiseInWords(invoice.grandTotalPaise)}`, MARGIN, y, 8, ink);
    y -= 14;
    await paint(document, page, regular, "This PDF is not an e-invoice and does not contain an IRP invoice reference number.", MARGIN, y, 7, muted);
    y -= 12;
  }
  if (settings.terms) {
    await paint(document, page, regular, settings.terms.slice(0, 400), MARGIN, y, 7, muted);
    y -= 16;
  }
  if (settings.showSignature) {
    page.drawText("Authorized signatory", { x: PAGE_WIDTH - MARGIN - 120, y: y - 20, size: 8, font: regular, color: muted });
  }

  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 70,
      y: 24,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return document.save();
}
