import JSZip from "jszip";

/** Minimal XLSX reader: every sheet as a dense string grid (no styles, no formulas evaluated). */

export type SheetGrid = { name: string; rows: string[][] };

function xmlText(chunk: string) {
  return chunk
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

export function columnIndex(letters: string) {
  return letters.split("").reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function sharedStrings(xml: string) {
  return (xml.match(/<si[\s\S]*?<\/si>/g) ?? []).map((block) =>
    [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]!)).join("")
  );
}

function sheetGrid(xml: string, shared: string[]): string[][] {
  const grid: string[][] = [];
  const cells = xml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? [];
  for (const cell of cells) {
    const ref = /\br="([A-Z]+)(\d+)"/.exec(cell);
    if (!ref) continue;
    const col = columnIndex(ref[1]!);
    const row = Number(ref[2]) - 1;
    if (row > 100_000 || col > 200) continue;
    const type = /\bt="([^"]+)"/.exec(cell)?.[1];
    const value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? "";
    let text: string;
    if (type === "s") text = shared[Number(value)] ?? "";
    else if (type === "inlineStr") text = xmlText(/<is>([\s\S]*?)<\/is>/.exec(cell)?.[1] ?? "");
    else text = xmlText(value);
    (grid[row] ??= [])[col] = text.trim();
  }
  return Array.from(grid, (row) => Array.from(row ?? [], (cell) => cell ?? ""));
}

export function isXlsx(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export async function readWorkbook(bytes: Uint8Array | ArrayBuffer): Promise<SheetGrid[]> {
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !rels) throw new Error("Not an Excel workbook.");
  const shared = sharedStrings((await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "");
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(match[0])?.[1];
    const target = /Target="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) {
      const clean = target.replace(/^\//, "").replace(/^\.\//, "");
      targets.set(id, clean.startsWith("xl/") ? clean : `xl/${clean}`);
    }
  }
  const sheets: SheetGrid[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText(/name="([^"]+)"/.exec(match[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(match[0])?.[1];
    const path = rid ? targets.get(rid) : undefined;
    const xml = path ? await zip.file(path)?.async("string") : undefined;
    if (xml) sheets.push({ name, rows: sheetGrid(xml, shared) });
  }
  return sheets;
}

/** Excel serial date (1900 system) to YYYY-MM-DD. */
export function excelSerialToIsoDate(serial: number) {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return date.toISOString().slice(0, 10);
}
