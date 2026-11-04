import JSZip from "jszip";
import { columnLetters } from "@/lib/xlsx/write";

/**
 * Fill the data rows of one sheet inside an existing .xlsx package, keeping every other part
 * (styles, theme, other sheets, workbook, content types) exactly as the template has them.
 * Used where a third party (India Post) expects their own workbook, not a look-alike.
 *
 * Cells are written as plain values only. No formula element is ever produced, so text such as
 * "=SUM(A1)" stays text in Excel.
 */

export type TemplateCellKind = "text" | "number" | "styledNumber" | "bool";
export type TemplateCellValue = string | number | boolean | null | undefined;

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function textCell(ref: string, value: string) {
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="str"><v${preserve}>${escapeText(value)}</v></c>`;
}

/** One cell, shaped like the template's own cells of that kind. Exported for tests. */
export function templateCellXml(ref: string, kind: TemplateCellKind, value: TemplateCellValue, numberStyle = 1) {
  if (kind === "bool") return `<c r="${ref}" t="b"><v>${value === true || value === 1 || value === "1" ? 1 : 0}</v></c>`;
  if (kind === "number" || kind === "styledNumber") {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(number)) return textCell(ref, "");
    const style = kind === "styledNumber" ? ` s="${numberStyle}"` : "";
    return `<c r="${ref}"${style}><v>${number}</v></c>`;
  }
  return textCell(ref, value == null ? "" : String(value));
}

export async function fillSheetTemplate(input: {
  /** The template package, as bytes or base64. */
  template: Uint8Array | string;
  /** Path of the sheet to fill, e.g. "xl/worksheets/sheet1.xml". */
  sheetPath: string;
  /** Column kinds, left to right; also fixes the column count. */
  kinds: TemplateCellKind[];
  rows: TemplateCellValue[][];
  /** Rows kept from the template before the data (header rows). */
  headerRows?: number;
  /** cellXfs index the template uses for its formatted numbers. */
  numberStyle?: number;
}) {
  // No folder entries: the template package has none, and the output must match it part for part.
  const zip = await JSZip.loadAsync(input.template, { base64: typeof input.template === "string", createFolders: false });
  const file = zip.file(input.sheetPath);
  if (!file) throw new Error(`Template has no ${input.sheetPath}.`);
  const xml = await file.async("string");
  const open = xml.indexOf("<sheetData>");
  const close = xml.indexOf("</sheetData>");
  if (open < 0 || close < 0) throw new Error("Template sheet has no sheetData.");

  const headerRows = input.headerRows ?? 1;
  const body = xml.slice(open + "<sheetData>".length, close);
  const kept = body.match(/<row\b[\s\S]*?<\/row>/g)?.slice(0, headerRows).join("") ?? "";
  const lastColumn = columnLetters(Math.max(1, input.kinds.length) - 1);
  const data = input.rows
    .map((row, index) => {
      const r = headerRows + index + 1;
      const cells = input.kinds.map((kind, column) =>
        templateCellXml(`${columnLetters(column)}${r}`, kind, row[column], input.numberStyle ?? 1)
      );
      return `<row r="${r}">${cells.join("")}</row>`;
    })
    .join("");
  const lastRow = headerRows + input.rows.length;
  const filled = (xml.slice(0, open + "<sheetData>".length) + kept + data + xml.slice(close))
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastColumn}${lastRow}"/>`)
    .replace(/(<ignoredError\b[^>]*\bsqref=")A1:[A-Z]+\d+(")/g, `$1A1:${lastColumn}${lastRow}$2`);

  zip.file(input.sheetPath, filled, { createFolders: false });
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}
