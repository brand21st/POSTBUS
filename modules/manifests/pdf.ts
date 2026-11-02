import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { drawPaintedText, needsUnicodePaint, wrapPaintText } from "@/modules/labels/unicode/paint";
import { sanitizeLabelText } from "@/modules/labels/unicode/text";
import { isWinAnsiText } from "@/modules/labels/unicode/winansi";
import type { ManifestDetail, ManifestSender } from "@/modules/manifests/service";

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const ROW_H = 15;
const BODY = 8.5;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);

type Column = { key: string; title: string; width: number; align?: "right" };

const COLUMNS: Column[] = [
  { key: "sno", title: "#", width: 24 },
  { key: "barcode", title: "Barcode", width: 84 },
  { key: "order", title: "Order", width: 64 },
  { key: "consignee", title: "Consignee", width: 128 },
  { key: "pincode", title: "PIN", width: 42 },
  { key: "service", title: "Service", width: 86 },
  { key: "weight", title: "Wt (g)", width: 42, align: "right" },
  { key: "cod", title: "COD (Rs)", width: 53, align: "right" },
];

/** Rows that fit on page 1 (taller header) and on follow-on pages. */
export const MANIFEST_PDF_ROWS = { first: 40, rest: 47 };

function cell(value: string | number | null | undefined, width: number) {
  let value_ = sanitizeLabelText(String(value ?? ""));
  if (!value_) return "";
  // Without the Indic painter Helvetica cannot encode non-WinAnsi text.
  if (!isWinAnsiText(value_) && !needsUnicodePaint(value_)) value_ = value_.replace(/[^\x20-\x7e]/g, "?");
  const lines = wrapPaintText(value_, width - 4, BODY);
  return lines.length > 1 ? `${lines[0]}…` : lines[0] ?? "";
}

function money(value: number) {
  return value.toFixed(2);
}

/**
 * Row counts per page. The last page also holds totals and the signature block,
 * so it keeps `footerRows` free (adding a page when needed).
 */
export function paginateManifestRows(lines: number, footerRows: number) {
  const pages: number[] = [];
  let left = lines;
  for (;;) {
    const capacity = pages.length === 0 ? MANIFEST_PDF_ROWS.first : MANIFEST_PDF_ROWS.rest;
    if (left <= capacity - footerRows) {
      pages.push(left);
      return pages;
    }
    // Never leave the footer alone on a page: carry at least one row over.
    const take = left <= capacity ? left - 1 : capacity;
    pages.push(take);
    left -= take;
  }
}

function footerRowsFor(services: number) {
  return Math.ceil((90 + services * 11) / ROW_H);
}

async function text(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size = BODY,
  options: { bold?: PDFFont; color?: typeof INK; align?: "right" } = {}
) {
  await drawPaintedText(doc, page, {
    text: value,
    x,
    y,
    size,
    font: options.bold ?? font,
    bold: Boolean(options.bold),
    color: options.color ?? INK,
    align: options.align,
  });
}

/** Paginated A4 pickup handover sheet; tables repeat their header on every page. */
export async function renderManifestPdf(manifest: ManifestDetail, sender: ManifestSender) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE[0] - MARGIN * 2;
  const pages = paginateManifestRows(manifest.lines.length, footerRowsFor(manifest.totals.byService.length));
  const totalPages = pages.length;
  const draft = manifest.status === "DRAFT";
  const office = [manifest.officeName, manifest.officeId ? `Office ID ${manifest.officeId}` : null]
    .filter(Boolean)
    .join(" · ") || "India Post office not set";
  doc.setTitle(`${manifest.number ?? "Draft manifest"} ${manifest.date}`);
  doc.setCreator("PostBus");

  let index = 0;
  for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
    const page = doc.addPage(PAGE);
    let y = PAGE[1] - MARGIN;

    if (draft) {
      page.drawText("DRAFT", { x: 150, y: 380, size: 120, font: bold, color: rgb(0.93, 0.93, 0.95), opacity: 0.8 });
    }

    if (pageNo === 1) {
      await text(doc, page, font, "India Post pickup manifest", MARGIN, y - 14, 16, { bold });
      await text(doc, page, font, manifest.number ?? "DRAFT — not closed", PAGE[0] - MARGIN, y - 14, 12, {
        bold,
        align: "right",
      });
      y -= 34;
      const meta: Array<[string, string]> = [
        ["Sender", sender.name],
        ["Customer ID", sender.customerId ?? "—"],
        ["Booking office", office],
        ["Manifest date", manifest.date],
      ];
      for (const [label, value] of meta) {
        await text(doc, page, font, label, MARGIN, y, 9, { color: MUTED });
        await text(doc, page, font, cell(value, width - 90), MARGIN + 90, y, 9);
        y -= 13;
      }
      y -= 6;
    } else {
      await text(doc, page, font, `${manifest.number ?? "DRAFT"} · ${manifest.date} · ${office}`, MARGIN, y - 10, 9, {
        color: MUTED,
      });
      y -= 22;
    }

    // Table header.
    page.drawRectangle({ x: MARGIN, y: y - 4, width, height: ROW_H, color: rgb(0.95, 0.95, 0.97) });
    let x = MARGIN;
    for (const column of COLUMNS) {
      await text(doc, page, font, column.title, column.align ? x + column.width - 3 : x + 3, y, BODY, {
        bold,
        align: column.align,
      });
      x += column.width;
    }
    y -= ROW_H;

    const slice = manifest.lines.slice(index, index + pages[pageNo - 1]);
    for (const line of slice) {
      index += 1;
      const values: Record<string, string> = {
        sno: String(index),
        barcode: line.barcode,
        order: line.orderNumber ?? "",
        consignee: line.consignee ?? "",
        pincode: line.pincode ?? "",
        service: line.serviceLabel,
        weight: String(line.weightGrams || ""),
        cod: line.codAmount > 0 ? money(line.codAmount) : "",
      };
      x = MARGIN;
      for (const column of COLUMNS) {
        const value = cell(values[column.key], column.width);
        await text(doc, page, font, value, column.align ? x + column.width - 3 : x + 3, y, BODY, {
          align: column.align,
        });
        x += column.width;
      }
      page.drawLine({
        start: { x: MARGIN, y: y - 4 },
        end: { x: MARGIN + width, y: y - 4 },
        thickness: 0.4,
        color: RULE,
      });
      y -= ROW_H;
    }

    if (pageNo === totalPages) {
      y -= 8;
      const totals = manifest.totals;
      await text(
        doc,
        page,
        font,
        `Total articles: ${totals.count}    Total weight: ${(totals.weightGrams / 1000).toFixed(3)} kg    COD articles: ${totals.codCount} (Rs ${money(totals.codAmount)})`,
        MARGIN,
        y,
        9,
        { bold }
      );
      y -= 13;
      for (const service of totals.byService) {
        await text(doc, page, font, `${service.label}: ${service.count} articles, ${(service.weightGrams / 1000).toFixed(3)} kg`, MARGIN, y, 8.5, {
          color: MUTED,
        });
        y -= 11;
      }
      // Signature block sits at the bottom of the last page.
      const sigY = y - 30;
      const half = (width - 30) / 2;
      for (const [offset, title] of [
        [0, "Handed over by (merchant)"],
        [half + 30, "Received by (India Post official)"],
      ] as const) {
        page.drawLine({
          start: { x: MARGIN + offset, y: sigY },
          end: { x: MARGIN + offset + half, y: sigY },
          thickness: 0.6,
          color: INK,
        });
        await text(doc, page, font, title, MARGIN + offset, sigY - 12, 8.5);
        await text(doc, page, font, "Name, signature, date & office stamp", MARGIN + offset, sigY - 23, 7.5, {
          color: MUTED,
        });
      }
    }

    await text(doc, page, font, `Page ${pageNo} of ${totalPages}`, PAGE[0] - MARGIN, MARGIN - 16, 7.5, {
      color: MUTED,
      align: "right",
    });
    await text(doc, page, font, "Generated by PostBus", MARGIN, MARGIN - 16, 7.5, { color: MUTED });
  }

  return doc.save();
}
