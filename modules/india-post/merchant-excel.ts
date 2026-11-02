import { readWorkbook, type SheetGrid } from "@/lib/xlsx/read";
import { writeWorkbook } from "@/lib/xlsx/write";
import {
  detectImportFormat,
  headerKey,
  POSTBRIDGE_TEMPLATE_HEADERS,
  suggestColumnMap,
  type ImportFormat,
} from "@/modules/india-post/excel-profiles";

export const BULK_EXCEL_MAX_ROWS = 5000;
export const BULK_EXCEL_MAX_BYTES = 8_000_000;

export type MerchantExcelRow = {
  excelRowNumber: number;
  raw: Record<string, string>;
  mapped: Record<string, string>;
  unmapped: Record<string, string>;
};

export type ParsedMerchantWorkbook = {
  sheetName: string;
  headerRowNumber: number;
  headers: string[];
  profile: ImportFormat;
  columnMap: Record<string, string>;
  unmappedHeaders: string[];
  otherSheets: string[];
  rows: MerchantExcelRow[];
  issues: Array<{ field: string; error: string }>;
};

function preserveCell(value: string) {
  const trimmed = value.trim();
  if (/^\d+\.0+$/.test(trimmed)) return trimmed.replace(/\.0+$/, "");
  return trimmed;
}

function rowCells(row: string[] | undefined, width: number) {
  const cells = row ?? [];
  return Array.from({ length: width }, (_, index) => preserveCell(cells[index] ?? ""));
}

function scoreRow(cells: string[]) {
  const { columnMap } = suggestColumnMap(
    cells.filter(Boolean),
    "postbus_standard"
  );
  return Object.keys(columnMap).length;
}

function findHeader(grid: SheetGrid) {
  const limit = Math.min(grid.rows.length, 30);
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < limit; index += 1) {
    const cells = (grid.rows[index] ?? []).map((cell) => preserveCell(cell ?? ""));
    const score = scoreRow(cells);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return { index: bestIndex, score: bestScore };
}

export function applyColumnMap(
  rows: Array<{ excelRowNumber: number; raw: Record<string, string> }>,
  headers: string[],
  columnMap: Record<string, string>
) {
  const used = new Set<string>();
  const normalized: Record<string, string> = {};
  const conflicts: string[] = [];
  for (const header of headers) {
    const field = (columnMap[header] ?? "").trim();
    if (!field) continue;
    if (used.has(field)) {
      conflicts.push(header);
      continue;
    }
    used.add(field);
    normalized[header] = field;
  }
  const mappedRows: MerchantExcelRow[] = rows.map((row) => {
    const mapped: Record<string, string> = {};
    const unmapped: Record<string, string> = {};
    for (const header of headers) {
      const value = row.raw[header] ?? "";
      const field = normalized[header];
      if (field) mapped[field] = value;
      else if (header.trim()) unmapped[header] = value;
    }
    return { excelRowNumber: row.excelRowNumber, raw: row.raw, mapped, unmapped };
  });
  return { columnMap: normalized, rows: mappedRows, conflicts };
}

function sheetFromGrid(grid: SheetGrid): ParsedMerchantWorkbook | null {
  const header = findHeader(grid);
  if (header.index < 0 || header.score < 2) return null;
  const width = Math.max(...grid.rows.map((row) => row?.length ?? 0), 1);
  const headerCells = rowCells(grid.rows[header.index], width);
  let last = 0;
  headerCells.forEach((cell, index) => {
    if (cell) last = index;
  });
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (const cell of headerCells.slice(0, last + 1)) {
    const label = cell || `Column ${headers.length + 1}`;
    const count = (seen.get(headerKey(label)) ?? 0) + 1;
    seen.set(headerKey(label), count);
    headers.push(count === 1 ? label : `${label} (${count})`);
  }
  const profile = detectImportFormat(headers, grid.name);
  const suggested = suggestColumnMap(headers, profile);
  const rawRows: Array<{ excelRowNumber: number; raw: Record<string, string> }> = [];
  for (let index = header.index + 1; index < grid.rows.length; index += 1) {
    const cells = rowCells(grid.rows[index], headers.length);
    if (cells.every((cell) => !cell)) continue;
    const raw: Record<string, string> = {};
    headers.forEach((headerName, column) => {
      raw[headerName] = cells[column] ?? "";
    });
    rawRows.push({ excelRowNumber: index + 1, raw });
  }
  const applied = applyColumnMap(rawRows, headers, suggested.columnMap);
  return {
    sheetName: grid.name,
    headerRowNumber: header.index + 1,
    headers,
    profile,
    columnMap: applied.columnMap,
    unmappedHeaders: headers.filter((item) => !applied.columnMap[item]),
    otherSheets: [],
    rows: applied.rows,
    issues: applied.conflicts.map((headerName) => ({
      field: headerName,
      error: `Column "${headerName}" repeats a field that is already mapped.`,
    })),
  };
}

export async function parseMerchantWorkbook(bytes: ArrayBuffer | Uint8Array): Promise<ParsedMerchantWorkbook> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let sheets: SheetGrid[];
  try {
    sheets = await readWorkbook(source);
  } catch {
    return {
      sheetName: "",
      headerRowNumber: 0,
      headers: [],
      profile: "postbridge",
      columnMap: {},
      unmappedHeaders: [],
      otherSheets: [],
      rows: [],
      issues: [{ field: "workbook", error: "The file is not a valid Excel workbook." }],
    };
  }
  const ranked = sheets
    .map((sheet) => ({ sheet, header: findHeader(sheet) }))
    .sort((left, right) => right.header.score - left.header.score);
  const preferred =
    ranked.find((item) => item.sheet.name.trim().toLowerCase() === "articledetails" && item.header.score >= 2) ??
    ranked.find((item) => item.header.score >= 2);
  if (!preferred) {
    return {
      sheetName: sheets[0]?.name ?? "",
      headerRowNumber: 0,
      headers: [],
      profile: "postbridge",
      columnMap: {},
      unmappedHeaders: [],
      otherSheets: sheets.map((sheet) => sheet.name),
      rows: [],
      issues: [{ field: "workbook", error: "Could not find a header row with shipment columns." }],
    };
  }
  const parsed = sheetFromGrid(preferred.sheet);
  if (!parsed) {
    return {
      sheetName: preferred.sheet.name,
      headerRowNumber: 0,
      headers: [],
      profile: "postbridge",
      columnMap: {},
      unmappedHeaders: [],
      otherSheets: sheets.filter((sheet) => sheet !== preferred.sheet).map((sheet) => sheet.name),
      rows: [],
      issues: [{ field: "workbook", error: "Could not find a header row with shipment columns." }],
    };
  }
  parsed.otherSheets = sheets.filter((sheet) => sheet.name !== parsed.sheetName).map((sheet) => sheet.name);
  if (parsed.rows.length > BULK_EXCEL_MAX_ROWS) {
    parsed.issues.push({
      field: "workbook",
      error: `This workbook has ${parsed.rows.length} shipment rows. The maximum is ${BULK_EXCEL_MAX_ROWS}.`,
    });
    parsed.rows = parsed.rows.slice(0, BULK_EXCEL_MAX_ROWS);
  }
  if (!parsed.rows.length) {
    parsed.issues.push({ field: "workbook", error: "The workbook has headers but no shipment rows." });
  }
  return parsed;
}

export async function postbridgeTemplateWorkbook() {
  return writeWorkbook([
    {
      name: "Shipments",
      rows: [POSTBRIDGE_TEMPLATE_HEADERS],
    },
  ]);
}

export function remapMerchantRows(
  parsed: Pick<ParsedMerchantWorkbook, "headers" | "rows">,
  columnMap: Record<string, string>
) {
  return applyColumnMap(
    parsed.rows.map((row) => ({ excelRowNumber: row.excelRowNumber, raw: row.raw })),
    parsed.headers,
    columnMap
  );
}
