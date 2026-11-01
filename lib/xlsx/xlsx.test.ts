import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, toCsv } from "@/lib/csv";
import { columnIndex, excelSerialToIsoDate, isXlsx, readWorkbook } from "@/lib/xlsx/read";
import { columnLetters, writeWorkbook } from "@/lib/xlsx/write";

describe("xlsx round trip", () => {
  it("writes and reads strings, numbers and escaped XML", async () => {
    const bytes = await writeWorkbook([
      { name: "COD/Report", rows: [["Article", "Amount"], ["EL835418390IN", 259.5], ["<b>&\"x\"", null]] },
      { name: "COD/Report", rows: [["second"]] },
    ]);
    expect(isXlsx(bytes)).toBe(true);
    const sheets = await readWorkbook(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["COD Report", "COD Report 2"]);
    expect(sheets[0]!.rows[1]).toEqual(["EL835418390IN", "259.5"]);
    expect(sheets[0]!.rows[2]![0]).toBe('<b>&"x"');
  });

  it("reads <v> values that carry xml:space", async () => {
    const zip = await JSZip.loadAsync(await writeWorkbook([{ name: "S", rows: [["x"]] }]));
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="str"><v xml:space="preserve">LENGTH </v></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>`
    );
    const sheets = await readWorkbook(await zip.generateAsync({ type: "uint8array" }));
    expect(sheets[0]!.rows[0]).toEqual(["LENGTH", "1"]);
  });

    it("maps column letters both ways", () => {
    for (const n of [0, 25, 26, 51, 52, 701, 702]) expect(columnIndex(columnLetters(n))).toBe(n);
    expect(columnLetters(27)).toBe("AB");
  });

  it("converts Excel serial dates", () => {
    expect(excelSerialToIsoDate(45658)).toBe("2025-01-01");
    expect(excelSerialToIsoDate(46314)).toBe("2026-10-19");
  });
});

describe("csv", () => {
  it("parses quotes, embedded commas and CRLF", () => {
    expect(parseCsv('a,"b,1","c ""q"""\r\n1,2,3\r\n\r\n')).toEqual([
      ["a", "b,1", 'c "q"'],
      ["1", "2", "3"],
    ]);
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });

  it("escapes and neutralises formulas", () => {
    expect(toCsv([["=SUM(A1)", 'x"y', 5]])).toBe(`'=SUM(A1),"x""y",5\r\n`);
  });
});
