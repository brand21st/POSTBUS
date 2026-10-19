/** India Post COD remittance report parsing: XLSX, CSV and PDF/text. Amounts in paise. */
import { detectDelimiter, parseCsv } from "@/lib/csv";
import { excelSerialToIsoDate, isXlsx, readWorkbook } from "@/lib/xlsx/read";
import { rupeesToPaise } from "@/modules/ai-accountant/money";

export const ARTICLE_RE = /\b([A-Z]{2}\d{9}[A-Z]{2})\b/;

export type CodExtractedRow = {
  articleBarcode: string;
  deliveredOn?: string | null;
  codAmountPaise: number;
  commissionPaise: number;
  netAmountPaise: number;
};

export type CodColumn = "article" | "cod" | "commission" | "net" | "date";
export type CodColumnMap = Partial<Record<CodColumn, number>>;
export type CodFormat = "XLSX" | "CSV" | "PDF" | "TEXT";

export type CodParseResult = {
  format: CodFormat;
  rows: CodExtractedRow[];
  columnMap: CodColumnMap | null;
  headers: string[];
  headerRow: number | null;
  warnings: string[];
};

const ALIASES: Record<CodColumn, RegExp[]> = {
  article: [/article/, /barcode/, /consignment/, /\bawb\b/, /tracking/, /\bart\.? ?no/],
  cod: [/cod ?(amount|amt|value)/, /vpp ?(amount|amt)/, /collect(ed|ion)/, /^cod$/, /amount collected/],
  commission: [/commission/, /\bcomm\b/, /service charge/, /charges?/],
  net: [/net/, /remit/, /payable/, /credited/],
  date: [/deliver/, /date/],
};

function normalise(header: string) {
  return header.toLowerCase().replace(/[_.\-/]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Best guess per column; each sheet column is used at most once, article first. */
export function detectColumns(headers: string[]): CodColumnMap {
  const map: CodColumnMap = {};
  const used = new Set<number>();
  const order: CodColumn[] = ["article", "net", "commission", "cod", "date"];
  for (const column of order) {
    const index = headers.findIndex((header, i) => !used.has(i) && ALIASES[column].some((re) => re.test(normalise(header))));
    if (index >= 0) {
      map[column] = index;
      used.add(index);
    }
  }
  return map;
}

/** Finds the header row in the first 25 rows (reports often start with title lines). */
export function findHeaderRow(grid: string[][]): number | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < Math.min(grid.length, 25); i += 1) {
    const map = detectColumns(grid[i] ?? []);
    if (map.article === undefined) continue;
    const score = Object.keys(map).length;
    if (!best || score > best.score) best = { index: i, score };
  }
  return best && best.score >= 2 ? best.index : null;
}

export function parseMoney(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/₹|rs\.?|inr/gi, "").replace(/\s+/g, "").trim();
  if (!cleaned) return null;
  return rupeesToPaise(cleaned);
}

export function parseReportDate(value: string | undefined | null): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text);
  if (match) return `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToIsoDate(Number(text));
  return null;
}

/** Applies a column map to a grid. Rows without a valid article number are skipped. */
export function rowsFromGrid(grid: string[][], headerRow: number | null, map: CodColumnMap): { rows: CodExtractedRow[]; skipped: number } {
  const rows: CodExtractedRow[] = [];
  let skipped = 0;
  const start = headerRow === null ? 0 : headerRow + 1;
  for (const cells of grid.slice(start)) {
    const articleCell = map.article !== undefined ? cells[map.article] : cells.find((cell) => ARTICLE_RE.test(cell));
    const article = ARTICLE_RE.exec(String(articleCell ?? "").toUpperCase())?.[1];
    if (!article) {
      if (cells.some((cell) => cell.trim())) skipped += 1;
      continue;
    }
    const cod = map.cod !== undefined ? parseMoney(cells[map.cod]) : null;
    const commission = map.commission !== undefined ? parseMoney(cells[map.commission]) : null;
    const net = map.net !== undefined ? parseMoney(cells[map.net]) : null;
    const codAmountPaise = cod ?? (net !== null ? net + (commission ?? 0) : null);
    if (codAmountPaise === null || codAmountPaise < 0) {
      skipped += 1;
      continue;
    }
    rows.push({
      articleBarcode: article,
      deliveredOn: map.date !== undefined ? parseReportDate(cells[map.date]) : null,
      codAmountPaise,
      commissionPaise: Math.max(0, commission ?? 0),
      netAmountPaise: net ?? codAmountPaise - Math.max(0, commission ?? 0),
    });
  }
  return { rows, skipped };
}

/**
 * Free-text line parser for PDF/text reports: article number, optional date, then
 * money columns. With three or more amounts the last three are COD, commission, net.
 */
export function parseCodReportText(text: string): CodExtractedRow[] {
  const rows: CodExtractedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const article = ARTICLE_RE.exec(line.toUpperCase())?.[1];
    if (!article) continue;
    const dateMatch = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})\b/.exec(line);
    const rest = line
      .replace(article, " ")
      .replace(dateMatch?.[0] ?? "\u0000", " ")
      .replace(/\b\d{6}\b/g, " "); // pincodes
    const amounts = [...rest.matchAll(/(?:₹|rs\.?\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)/gi)]
      .map((match) => rupeesToPaise(match[1]!.replace(/,/g, "")))
      .filter((value): value is number => value !== null && value >= 0);
    if (!amounts.length) continue;
    const [codAmountPaise, commissionPaise, netAmountPaise] =
      amounts.length >= 3 ? amounts.slice(-3) : amounts.length === 2 ? [amounts[0]!, amounts[0]! - amounts[1]!, amounts[1]!] : [amounts[0]!, 0, amounts[0]!];
    rows.push({
      articleBarcode: article,
      deliveredOn: parseReportDate(dateMatch?.[0]),
      codAmountPaise: codAmountPaise!,
      commissionPaise: Math.max(0, commissionPaise!),
      netAmountPaise: netAmountPaise!,
    });
  }
  return rows;
}

function isPdf(bytes: Uint8Array) {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** PDF text as lines, grouping text items that share a baseline. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const g = globalThis as { pdfjsWorker?: unknown };
  // Registering the worker module makes pdfjs use it in-process instead of resolving a worker file path.
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(0), useSystemFonts: false });
  const pdf = await task.promise;
  const lines: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 200); n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const byY = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.transform) continue;
      const y = Math.round(item.transform[5]! / 2) * 2;
      const list = byY.get(y) ?? [];
      list.push({ x: item.transform[4]!, s: item.str });
      byY.set(y, list);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      lines.push(byY.get(y)!.sort((a, b) => a.x - b.x).map((part) => part.s).join(" "));
    }
  }
  await task.destroy();
  return lines.join("\n");
}

function gridResult(format: CodFormat, grid: string[][], override?: CodColumnMap | null): CodParseResult {
  const headerRow = findHeaderRow(grid);
  const headers = headerRow === null ? [] : grid[headerRow] ?? [];
  const columnMap = override ?? (headerRow === null ? {} : detectColumns(headers));
  const { rows, skipped } = rowsFromGrid(grid, headerRow, columnMap);
  const warnings: string[] = [];
  if (headerRow === null) warnings.push("No header row found; amounts could not be mapped. Map the columns manually.");
  if (columnMap.cod === undefined && columnMap.net === undefined) warnings.push("No COD or net amount column detected.");
  if (skipped) warnings.push(`${skipped} rows were skipped (no article number or amount).`);
  return { format, rows, columnMap, headers, headerRow, warnings };
}

export async function parseCodFile(bytes: Uint8Array, fileName: string, override?: CodColumnMap | null): Promise<CodParseResult> {
  if (isXlsx(bytes)) {
    const sheets = await readWorkbook(bytes);
    const sheet = sheets.find((s) => findHeaderRow(s.rows) !== null) ?? sheets[0];
    return gridResult("XLSX", sheet?.rows ?? [], override);
  }
  if (isPdf(bytes)) {
    const rows = parseCodReportText(await pdfToText(bytes));
    return {
      format: "PDF",
      rows,
      columnMap: null,
      headers: [],
      headerRow: null,
      warnings: rows.length ? ["PDF amounts are read from text; review before relying on them."] : ["No article numbers found in the PDF."],
    };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (/\.csv$/i.test(fileName) || /[,;\t]/.test(text.split(/\r?\n/)[0] ?? "")) {
    const grid = parseCsv(text, detectDelimiter(text));
    const result = gridResult("CSV", grid, override);
    if (result.rows.length || override) return result;
  }
  const rows = parseCodReportText(text);
  return { format: "TEXT", rows, columnMap: null, headers: [], headerRow: null, warnings: rows.length ? [] : ["No article numbers found."] };
}
