import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readWorkbook } from "@/lib/xlsx/read";
import { writeWorkbook } from "@/lib/xlsx/write";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { mapExcelRowToArticle } from "@/modules/india-post/article-mapper";
import {
  ARTICLE_DETAILS_HEADERS,
  articleDetailsFilename,
  articleDetailsParts,
  articleDetailsRow,
  articleDetailsWorkbook,
  normalizeExcelBookingLimit,
  parseExcelBookingLimit,
} from "@/modules/india-post/article-details-sheet";
import { withArticleKeys } from "@/modules/india-post/bulk-excel-validate";
import { parseMerchantWorkbook } from "@/modules/india-post/merchant-excel";

/** One row as India Post's bulk-customer template carries it (values from a real PostBridge export shape). */
const SAMPLE: Record<(typeof ARTICLE_DETAILS_HEADERS)[number], string | number | boolean> = {
  "SERIAL NUMBER": 1,
  "BARCODE NO": "EY571879949IN",
  "PHYSICAL WEIGHT": 100,
  REG: false,
  OTP: false,
  "RECEIVER CITY": "Kolkata",
  "RECEIVER PINCODE": "700162",
  "RECEIVER NAME": "Sushanta Mistry",
  "RECEIVER ADD LINE 1": "New town gouranga nagar",
  "RECEIVER ADD LINE 2": "Near the post office",
  "RECEIVER ADD LINE 3": "West Bengal",
  ACK: false,
  "SENDER MOBILE NO": "8089117541",
  "RECEIVER MOBILE NO": "7998188311",
  "PREPAYMENT CODE": "",
  "VALUE OF PREPAYMENT": "",
  "CODR/COD": "cod",
  "VALUE FOR CODR/COD": 1199,
  "INSURANCE TYPE": "",
  "VALUE OF INSURANCE": "",
  "SHAPE OF ARTICLE": "NROL",
  "LENGTH ": 20,
  "BREADTH/DIAMETER": 15,
  HEIGHT: 2,
  "PRIORITY FLAG": true,
  "DELIVERY INSTRUCTION": "",
  "DELIVERY SLOT": "",
  "INSTRUCTION RTS": "",
  "SENDER NAME": "KL TRENDS SP",
  "SENDER COMPANY NAME": "KL TRENDS SP",
  "SENDER CITY": "TIRUR",
  "SENDER STATE/UT": "KERALA",
  "SENDER PINCODE": "676102",
  "SENDER EMAILID": "",
  "SENDER ALT CONTACT": "7356801380",
  "SENDER KYC": "",
  "SENDER TAX": "",
  "RECEIVER COMPANY NAME": "",
  "RECEIVER STATE/UT": "West Bengal",
  "RECEIVER EMAILID": "buyer@example.com",
  "RECEIVER ALT CONTACT": "",
  "RECEIVER KYC": "",
  "RECEIVER TAX REF": "",
  "ALT ADDRESS FLAG": "",
  "BULK REFERENCE": "#7815",
  "SENDER ADD LINE 1": "KLTRENDS TIRURE",
  "SENDER ADD LINE 2": "CHAMRAVATTOM ROAD PERUNTHALLUR",
  "SENDER ADD LINE 3": "TIRUR",
};

async function sampleWorkbook() {
  return writeWorkbook([
    { name: "ArticleDetails", rows: [[...ARTICLE_DETAILS_HEADERS], ARTICLE_DETAILS_HEADERS.map((header) => SAMPLE[header])] },
    { name: "Information", rows: [["SHAPE OF ARTICLE"], ["ROLL"]] },
  ]);
}

function emptyToNull(value: unknown) {
  return value === "" ? null : value;
}

describe("India Post ArticleDetails sheet", () => {
  it("imports every column of the India Post template", async () => {
    const parsed = await parseMerchantWorkbook(await sampleWorkbook());
    expect(parsed.sheetName).toBe("ArticleDetails");
    expect(parsed.profile).toBe("cept_official");
    expect(parsed.unmappedHeaders).toEqual([]);
    const mapped = parsed.rows[0]!.mapped;
    expect(mapped.sender_company).toBe("KL TRENDS SP");
    expect(mapped.receiver_state).toBe("West Bengal");
    expect(mapped.sender_alt_contact).toBe("7356801380");
    expect(mapped.priority_flag).toBe("1");
    expect(mapped.length).toBe("20");
  });

  it("round-trips an imported row back to the same ArticleDetails cells", async () => {
    const parsed = await parseMerchantWorkbook(await sampleWorkbook());
    const draft = mapExcelRowToArticle({
      serial: "2",
      serviceCode: "SP_INLAND_PARCEL",
      customerId: "",
      contractId: "",
      officeId: "",
      originPin: "",
      row: withArticleKeys(parsed.rows[0]!.mapped),
    });
    const cells = articleDetailsRow(draft, 1);
    expect(cells).toHaveLength(48);
    expect(cells).toEqual(ARTICLE_DETAILS_HEADERS.map((header) => emptyToNull(SAMPLE[header]) ?? cellDefault(header)));
  });

  it("writes ArticleDetails and Information sheets with the template's cell types", async () => {
    const bytes = await articleDetailsWorkbook([
      ARTICLE_DETAILS_HEADERS.map((header) => SAMPLE[header]),
      ARTICLE_DETAILS_HEADERS.map((header) => SAMPLE[header]),
    ]);
    const sheets = await readWorkbook(bytes);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["ArticleDetails", "Information"]);
    expect(sheets[0]!.rows[0]).toEqual(ARTICLE_DETAILS_HEADERS.map((header) => header.trim()));
    expect(sheets[0]!.rows.map((row) => row[0])).toEqual(["SERIAL NUMBER", "1", "2"]);
    const xml = await (await JSZip.loadAsync(bytes)).file("xl/worksheets/sheet1.xml")!.async("string");
    expect(xml).toContain('<c r="D2" t="b"><v>0</v></c>');
    expect(xml).toContain('<c r="Y2" t="b"><v>1</v></c>');
    // Same cell shapes as the India Post template: text as t="str", formatted numbers with s="1".
    expect(xml).toContain('<c r="G2" t="str"><v>700162</v></c>');
    expect(xml).toContain('<c r="R2" s="1"><v>1199</v></c>');
    expect(xml).toContain('<c r="C2" s="1"><v>100</v></c>');
    expect(xml).not.toContain("<f>");
  });

  it("splits rows into files by the workspace limit", () => {
    expect(articleDetailsParts(0, 100)).toEqual([]);
    expect(articleDetailsParts(118, 5000)).toEqual([{ part: 1, from: 1, to: 118, count: 118 }]);
    expect(articleDetailsParts(2500, 999).map((part) => [part.from, part.to])).toEqual([
      [1, 999],
      [1000, 1998],
      [1999, 2500],
    ]);
  });

  it("keeps the limit inside India Post's 1..5000 file cap", () => {
    expect(normalizeExcelBookingLimit(undefined)).toBe(5000);
    expect(normalizeExcelBookingLimit(null)).toBe(5000);
    expect(normalizeExcelBookingLimit(9000)).toBe(5000);
    expect(normalizeExcelBookingLimit(250.7)).toBe(250);
    expect(parseExcelBookingLimit("999")).toBe(999);
    expect(() => parseExcelBookingLimit(0)).toThrow(/1 to 5000/);
    expect(() => parseExcelBookingLimit(5001)).toThrow(/1 to 5000/);
    expect(() => parseExcelBookingLimit(12.5)).toThrow(/whole number/);
  });

  it("names files like the India Post export", () => {
    expect(articleDetailsFilename({ count: 118, storeName: "KL Trends", date: "2026-10-01" })).toBe(
      "118_kltrends_2026-10-01_postbus.xlsx"
    );
    expect(articleDetailsFilename({ count: 999, storeName: "KL Trends", date: "2026-10-01", part: 2, parts: 3 })).toBe(
      "999_kltrends_2026-10-01_postbus_part2.xlsx"
    );
  });

  it("requires integrations.manage to change the limit", () => {
    expect(permissionForTenantRoute("PATCH", "bookings/excel-settings", ["bookings", "excel-settings"])).toBe(
      "integrations.manage"
    );
    expect(permissionForTenantRoute("GET", "bookings/excel-settings", ["bookings", "excel-settings"])).toBe(
      "shipments.read"
    );
    expect(
      permissionForTenantRoute("GET", "bookings/excel-imports/b1/india-post-export", [
        "bookings",
        "excel-imports",
        "b1",
        "india-post-export",
      ])
    ).toBe("shipments.read");
  });
});

/** Blank cells the sample leaves empty come back as "" (text) or null (number/flag). */
function cellDefault(header: string) {
  return ["VALUE OF PREPAYMENT", "VALUE OF INSURANCE", "ALT ADDRESS FLAG"].includes(header) ? null : "";
}
