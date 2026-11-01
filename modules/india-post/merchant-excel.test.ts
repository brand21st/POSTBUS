import { describe, expect, it } from "vitest";
import { writeWorkbook } from "@/lib/xlsx/write";
import { readWorkbook } from "@/lib/xlsx/read";
import { BULK_EXCEL_MAX_ROWS, parseMerchantWorkbook, postbridgeTemplateWorkbook } from "@/modules/india-post/merchant-excel";
import { detectImportFormat, suggestColumnMap } from "@/modules/india-post/excel-profiles";

const postbridgeHeaders = [
  "Notes",
  "ORDER ID",
  "BARCODE NO",
  "RECEIVER NAME",
  "RECEIVER MOBILE NO",
  "RECEIVER PINCODE",
  "RECEIVER ADD LINE 1",
  "CITY",
  "PHYSICAL WEIGHT",
  "CODR/COD",
  "VALUE FOR CODR/COD",
  "INTERNAL SKU",
];

describe("merchant Excel parser", () => {
  it("finds a header row below a title and keeps text, unicode, blanks, and unmapped columns", async () => {
    const bytes = await writeWorkbook([
      {
        name: "Orders",
        rows: [
          ["KL Trends export"],
          postbridgeHeaders,
          ["", "1001", "RK000000510IN", "राजेश कुमार", "09876543210", "060052", "12 Market Road", "Chennai", "1000", "COD", "150.50", "SKU-1"],
          ["", "", "", "", "", "", "", "", "", "", "", ""],
          ["", "1002", "9.876E+12", "Second Customer", "", "", "Lane", "Delhi", "500", "", "", "SKU-2"],
        ],
      },
      { name: "Instructions", rows: [["Read me"]] },
    ]);
    const parsed = await parseMerchantWorkbook(bytes);
    expect(parsed.profile).toBe("postbridge");
    expect(parsed.headerRowNumber).toBe(2);
    expect(parsed.otherSheets).toEqual(["Instructions"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.excelRowNumber).toBe(3);
    expect(parsed.rows[0]?.mapped.receiver_name).toBe("राजेश कुमार");
    expect(parsed.rows[0]?.mapped.receiver_mobile_no).toBe("09876543210");
    expect(parsed.rows[0]?.mapped.receiver_pincode).toBe("060052");
    expect(parsed.rows[0]?.mapped.barcode_no).toBe("RK000000510IN");
    expect(parsed.rows[0]?.unmapped["INTERNAL SKU"]).toBe("SKU-1");
    expect(parsed.unmappedHeaders).toContain("INTERNAL SKU");
    expect(parsed.unmappedHeaders).toContain("Notes");
    expect(parsed.rows[1]?.mapped.barcode_no).toBe("9.876E+12");
    expect(parsed.rows[1]?.mapped.receiver_mobile_no).toBe("");
    const reread = await readWorkbook(bytes);
    expect(reread[0]?.rows[2]?.[3]).toBe("राजेश कुमार");
  });

  it("maps the official ArticleDetails sheet without hardcoding a column count", async () => {
    const bytes = await writeWorkbook([
      {
        name: "ArticleDetails",
        rows: [
          ["SERIAL NUMBER", "BARCODE NO", "PHYSICAL WEIGHT", "RECEIVER NAME", "RECEIVER PINCODE", "EXTRA"],
          ["1", "RK000000510IN", "1000", "Asha", "600052", "keep"],
        ],
      },
    ]);
    const parsed = await parseMerchantWorkbook(bytes);
    expect(parsed.profile).toBe("cept_official");
    expect(parsed.columnMap["BARCODE NO"]).toBe("barcode_no");
    expect(parsed.rows[0]?.unmapped.EXTRA).toBe("keep");
    expect(detectImportFormat(parsed.headers, "ArticleDetails")).toBe("cept_official");
  });

  it("rejects a workbook with no shipment header", async () => {
    const bytes = await writeWorkbook([{ name: "Notes", rows: [["Hello"], ["World"]] }]);
    const parsed = await parseMerchantWorkbook(bytes);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues[0]?.error).toMatch(/header row/i);
  });

  it("keeps the documented row cap", () => {
    expect(BULK_EXCEL_MAX_ROWS).toBe(5000);
  });

  it("writes a PostBus template whose headers map automatically", async () => {
    const bytes = await postbridgeTemplateWorkbook();
    const parsed = await parseMerchantWorkbook(bytes);
    const suggested = suggestColumnMap(parsed.headers, "postbus_standard");
    expect(suggested.columnMap["BARCODE NO"]).toBe("barcode_no");
    expect(suggested.columnMap["RECEIVER PINCODE"]).toBe("receiver_pincode");
    expect(suggested.columnMap["CODR/COD"]).toBe("codr_cod");
  });
});
