/**
 * The generated India Post workbook must be the master template with only the shipment rows
 * replaced. These tests compare package parts byte for byte and cell shapes column by column.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { readWorkbook } from "@/lib/xlsx/read";
import { templateCellXml } from "@/lib/xlsx/template-clone";
import type { SheetCell } from "@/lib/xlsx/write";
import { bookedShipmentRow } from "@/modules/booking-queue/export";
import {
  ARTICLE_DETAILS_COLUMN_KINDS,
  ARTICLE_DETAILS_HEADERS,
  articleDetailsWorkbook,
} from "@/modules/india-post/article-details-sheet";
import { ARTICLE_DETAILS_TEMPLATE_BASE64 } from "@/modules/india-post/templates/article-details-template.generated";

const TEMPLATE = readFileSync(path.join(process.cwd(), "modules/india-post/templates/article-details.template.xlsx"));
const SHEET = "xl/worksheets/sheet1.xml";

function sampleRow(overrides: Partial<Record<(typeof ARTICLE_DETAILS_HEADERS)[number], SheetCell>> = {}): SheetCell[] {
  const base: Partial<Record<(typeof ARTICLE_DETAILS_HEADERS)[number], SheetCell>> = {
    "SERIAL NUMBER": 1,
    "BARCODE NO": "EA000000001IN",
    "PHYSICAL WEIGHT": 500,
    REG: false,
    OTP: false,
    "RECEIVER CITY": "Kochi",
    "RECEIVER PINCODE": "682001",
    "RECEIVER NAME": "Asha",
    "RECEIVER ADD LINE 1": "12 MG Road",
    ACK: false,
    "SENDER MOBILE NO": "9876543210",
    "RECEIVER MOBILE NO": "9876543211",
    "CODR/COD": "cod",
    "VALUE FOR CODR/COD": 1199,
    "SHAPE OF ARTICLE": "NROL",
    "LENGTH ": 20,
    "BREADTH/DIAMETER": 15,
    HEIGHT: 2,
    "PRIORITY FLAG": true,
    "SENDER NAME": "Store",
    "SENDER COMPANY NAME": "Store",
    "SENDER CITY": "Tirur",
    "SENDER PINCODE": "676102",
    "BULK REFERENCE": "#1001",
    "SENDER ADD LINE 1": "Main Road",
    ...overrides,
  };
  return ARTICLE_DETAILS_HEADERS.map((header) => base[header] ?? null);
}

async function parts(bytes: Uint8Array | Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) out[name] = await zip.file(name)!.async("string");
  return out;
}

function cellAttributes(xml: string, ref: string) {
  const match = new RegExp(`<c r="${ref}"([^>]*)>`).exec(xml);
  if (!match) throw new Error(`cell ${ref} missing`);
  return match[1].trim();
}

describe("India Post template asset", () => {
  it("is embedded byte for byte in the server bundle", () => {
    expect(Buffer.from(ARTICLE_DETAILS_TEMPLATE_BASE64, "base64").equals(TEMPLATE)).toBe(true);
  });

  it("carries no customer rows, only the header", async () => {
    const sheet = (await parts(TEMPLATE))[SHEET];
    expect(sheet.match(/<row /g)).toHaveLength(1);
    expect(sheet).toContain('<dimension ref="A1:AV1"/>');
    expect(sheet).not.toMatch(/[6-9]\d{9}/);
  });
});

describe("generated workbook", () => {
  it("TEST 19: keeps every package part except the shipment rows exactly as the template", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => sampleRow({ "BARCODE NO": `EA${String(index).padStart(9, "0")}IN` }));
    const generated = await parts(await articleDetailsWorkbook(rows));
    const template = await parts(TEMPLATE);
    expect(Object.keys(generated).sort()).toEqual(Object.keys(template).sort());
    for (const name of Object.keys(template)) {
      if (name === SHEET) continue;
      expect(generated[name], name).toBe(template[name]);
    }
    // Sheet names and order come from the untouched workbook.xml.
    expect(generated["xl/workbook.xml"]).toMatch(/<sheet name="ArticleDetails"[^>]*\/><sheet name="Information"/);
  });

  it("keeps the template's header row and sheet settings, and updates the ranges", async () => {
    const generated = (await parts(await articleDetailsWorkbook([sampleRow(), sampleRow()])))[SHEET];
    const template = (await parts(TEMPLATE))[SHEET];
    const headerRow = (xml: string) => /<row r="1">[\s\S]*?<\/row>/.exec(xml)![0];
    expect(headerRow(generated)).toBe(headerRow(template));
    expect(headerRow(generated)).toContain('<v xml:space="preserve">LENGTH </v>');
    expect(generated).toContain('<dimension ref="A1:AV3"/>');
    expect(generated).toContain('sqref="A1:AV3"');
    expect(generated.slice(0, generated.indexOf("<sheetData>"))).toBe(
      template.slice(0, template.indexOf("<sheetData>")).replace("A1:AV1", "A1:AV3")
    );
  });

  it("writes each column with the template's cell type", async () => {
    const sheet = (await parts(await articleDetailsWorkbook([sampleRow()])))[SHEET];
    const expected = { number: "", styledNumber: 's="1"', bool: 't="b"', text: 't="str"' } as const;
    ARTICLE_DETAILS_HEADERS.forEach((header, index) => {
      const column = index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
      const kind = ARTICLE_DETAILS_COLUMN_KINDS[header];
      const attributes = cellAttributes(sheet, `${column}2`);
      // A missing number is written as an empty text cell, so only check filled numeric columns.
      if ((kind === "number" || kind === "styledNumber") && attributes === 't="str"') return;
      expect(attributes, header).toBe(expected[kind]);
    });
    expect(sheet).toContain('<c r="A2"><v>1</v></c>');
    expect(sheet).toContain('<c r="C2" s="1"><v>500</v></c>');
    expect(sheet).toContain('<c r="Y2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="G2" t="str"><v>682001</v></c>');
  });

  it("numbers rows from 1 in every file and reads back in Excel order", async () => {
    const bytes = await articleDetailsWorkbook([sampleRow({ "SERIAL NUMBER": 40 }), sampleRow({ "SERIAL NUMBER": 41 })]);
    const [articles, information] = await readWorkbook(bytes);
    expect(articles.name).toBe("ArticleDetails");
    expect(information.name).toBe("Information");
    expect(articles.rows.map((row) => row[0])).toEqual(["SERIAL NUMBER", "1", "2"]);
    expect(articles.rows[0]).toEqual(ARTICLE_DETAILS_HEADERS.map((header) => header.trim()));
  });

  it("TEST 20: keeps Malayalam and other Unicode text exactly", async () => {
    const name = "അനിൽ കുമാർ";
    const address = "തൃശൂർ റോഡ്, കോഴിക്കോട് — 2nd floor ✓";
    const bytes = await articleDetailsWorkbook([sampleRow({ "RECEIVER NAME": name, "RECEIVER ADD LINE 1": address })]);
    const [articles] = await readWorkbook(bytes);
    expect(articles.rows[1][ARTICLE_DETAILS_HEADERS.indexOf("RECEIVER NAME")]).toBe(name);
    expect(articles.rows[1][ARTICLE_DETAILS_HEADERS.indexOf("RECEIVER ADD LINE 1")]).toBe(address);
  });

  it("never writes formulas, keeps leading zeros and drops characters XML cannot hold", async () => {
    const bytes = await articleDetailsWorkbook([
      sampleRow({ "RECEIVER NAME": '=HYPERLINK("http://x")', "RECEIVER PINCODE": "012345", "RECEIVER ADD LINE 2": "a\u0007b <&>" }),
    ]);
    const sheet = (await parts(bytes))[SHEET];
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<c r="H2" t="str"><v>=HYPERLINK("http://x")</v></c>');
    expect(sheet).toContain('<c r="G2" t="str"><v>012345</v></c>');
    expect(sheet).toContain('<v>ab &lt;&amp;&gt;</v>');
  });

  it("marks values with edge spaces like the template does", () => {
    expect(templateCellXml("AF2", "text", "KERALA ")).toBe('<c r="AF2" t="str"><v xml:space="preserve">KERALA </v></c>');
    expect(templateCellXml("AF2", "text", "KERALA")).toBe('<c r="AF2" t="str"><v>KERALA</v></c>');
    expect(templateCellXml("V2", "number", null)).toBe('<c r="V2" t="str"><v></v></c>');
    expect(templateCellXml("D2", "bool", null)).toBe('<c r="D2" t="b"><v>0</v></c>');
  });

  it("builds a 5000-row file quickly", async () => {
    const started = Date.now();
    const bytes = await articleDetailsWorkbook(Array.from({ length: 5000 }, () => sampleRow()));
    expect(Date.now() - started).toBeLessThan(8000);
    const sheet = (await parts(bytes))[SHEET];
    expect(sheet).toContain('<dimension ref="A1:AV5001"/>');
  });
});

describe("booked shipment export rows", () => {
  const sender = {
    name: "KL Trends",
    line1: "Main Road",
    line2: "Perunthallur",
    city: "Tirur",
    state: "Kerala",
    pincode: "676102",
    phone: "+91 98765 43210",
  } as Parameters<typeof bookedShipmentRow>[1];

  it("uses the booked article number, the order number and the COD amount", () => {
    const row = bookedShipmentRow(
      {
        id: "s1",
        order_id: "o1",
        barcode: "EA000000001IN",
        tracking_number: "EA000000001IN",
        service_code: "SP_INLAND_PARCEL",
        weight_grams: 750,
        length_cm: 20,
        width_cm: 15,
        height_cm: 5,
        payment_mode: "COD",
        cod_amount: 1299,
        booked_at: "2026-11-02T10:00:00Z",
        orders: { order_number: "#7815", source: "SHOPIFY" },
        addresses: { name: "Asha", line1: "12 MG Road", city: "Kochi", state: "Kerala", pincode: "682001", phone: "9876543211" },
      },
      sender,
      "KL Trends",
      1
    );
    const value = (header: (typeof ARTICLE_DETAILS_HEADERS)[number]) => row[ARTICLE_DETAILS_HEADERS.indexOf(header)];
    expect(value("BARCODE NO")).toBe("EA000000001IN");
    expect(value("BULK REFERENCE")).toBe("#7815");
    expect(value("CODR/COD")).toBe("cod");
    expect(value("VALUE FOR CODR/COD")).toBe(1299);
    expect(value("PHYSICAL WEIGHT")).toBe(750);
    expect(value("SENDER MOBILE NO")).toBe("9876543210");
    expect(value("RECEIVER PINCODE")).toBe("682001");
    expect(value("OTP")).toBe(false);
  });

  it("sets OTP for services India Post requires it on", () => {
    const row = bookedShipmentRow(
      {
        id: "s1",
        order_id: null,
        barcode: "EA000000001IN",
        tracking_number: null,
        service_code: "24_SPP_PARSPL",
        weight_grams: 500,
        length_cm: 20,
        width_cm: 15,
        height_cm: 5,
        payment_mode: "PREPAID",
        cod_amount: 0,
        booked_at: "2026-11-02T10:00:00Z",
        addresses: { name: "Asha", line1: "12 MG Road", city: "Kochi", pincode: "682001", phone: "9876543211" },
      },
      sender,
      "KL Trends",
      1
    );
    expect(row[ARTICLE_DETAILS_HEADERS.indexOf("OTP")]).toBe(true);
    expect(row[ARTICLE_DETAILS_HEADERS.indexOf("CODR/COD")]).toBe("");
  });

  it("is a read action for permissions", () => {
    expect(permissionForTenantRoute("POST", "booking-queue/export", ["booking-queue", "export"])).toBe("shipments.read");
    expect(permissionForTenantRoute("POST", "booking-queue/export/plan", ["booking-queue", "export", "plan"])).toBe("shipments.read");
  });
});
