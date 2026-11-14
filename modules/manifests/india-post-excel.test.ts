import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readWorkbook } from "@/lib/xlsx/read";
import { bookedShipmentRow } from "@/modules/booking-queue/export";
import { ARTICLE_DETAILS_HEADERS, articleDetailsWorkbook } from "@/modules/india-post/article-details-sheet";
import {
  indiaPostExcelFilename,
  joinManifestExcelFailures,
  manifestExcelArticleErrors,
  manifestExcelEligibilityError,
  type ManifestExcelContext,
  type ManifestExcelShipment,
} from "@/modules/manifests/india-post-excel";

const BARCODE = "CL556973995IN";

const sender = {
  name: "KL TRENDS SP",
  phone: "8089117541",
  line1: "KLTRENDS TIRURE",
  line2: "CHAMRAVATTOM ROAD PERUNTHALLUR",
  city: "TIRUR",
  state: "KERALA",
  pincode: "676102",
};

const context: ManifestExcelContext = {
  sender,
  senderCompany: "KL TRENDS SP",
  customerId: "1000000001",
  officeId: "12345678",
  fallbackContractId: "87654321",
  contractByService: new Map([["SP_INLAND_PARCEL", "87654321"]]),
};

function shipment(overrides: Partial<ManifestExcelShipment> = {}): ManifestExcelShipment {
  return {
    id: "ship-1",
    status: "BOOKED",
    booked_at: "2026-11-14T00:00:00.000Z",
    barcode: BARCODE,
    tracking_number: BARCODE,
    service_code: "SP_INLAND_PARCEL",
    weight_grams: 100,
    length_cm: 20,
    width_cm: 15,
    height_cm: 2,
    payment_mode: "COD",
    cod_amount: 1199,
    orderNumber: "PB-1001",
    address: {
      name: "Sushanta Mistry",
      line1: "New town gouranga nagar",
      line2: "Near the post office",
      city: "Kolkata",
      state: "West Bengal",
      pincode: "700162",
      phone: "7998188311",
      email: "buyer@example.com",
    },
    ...overrides,
  };
}

describe("manifest India Post Excel", () => {
  it("sanitizes the download filename", () => {
    expect(indiaPostExcelFilename({ number: "MF 12/A", date: "2026-11-14", officeId: "1" })).toBe(
      "manifest_MF_12_A_india_post.xlsx"
    );
  });

  it("rejects shipments that are not a confirmed booked article", () => {
    expect(manifestExcelEligibilityError(shipment({ booked_at: null }))).toMatch(/confirmed/);
    expect(manifestExcelEligibilityError(shipment({ barcode: null, tracking_number: null }))).toMatch(/no barcode/);
    expect(manifestExcelEligibilityError(shipment({ barcode: "CL556973990IN", tracking_number: null }))).toMatch(/13-character/);
    expect(manifestExcelEligibilityError(shipment({ status: "CANCELLED" }))).toMatch(/cancelled/);
    expect(manifestExcelEligibilityError(shipment({ status: "FAILED" }))).toMatch(/failed/);
    expect(manifestExcelEligibilityError(shipment({ status: "RECOVERY_REQUIRED" }))).toMatch(/unresolved/);
    expect(manifestExcelEligibilityError(shipment())).toBeNull();
  });

  it("names the failing order and barcode and does not mention another workspace", () => {
    const message = joinManifestExcelFailures([`PB-1001 · ${BARCODE}: was cancelled`]);
    expect(message).toContain(`PB-1001 · ${BARCODE}`);
    expect(message).not.toMatch(/other organization/i);
  });

  it("writes one ArticleDetails workbook from the booked-row mapper", async () => {
    expect(manifestExcelArticleErrors(shipment(), context)).toEqual([]);
    const row = shipment();
    const cells = bookedShipmentRow(
      {
        id: row.id,
        order_id: null,
        barcode: row.barcode ?? null,
        tracking_number: row.tracking_number ?? null,
        service_code: row.service_code ?? null,
        weight_grams: row.weight_grams ?? null,
        length_cm: row.length_cm ?? null,
        width_cm: row.width_cm ?? null,
        height_cm: row.height_cm ?? null,
        payment_mode: row.payment_mode ?? null,
        cod_amount: row.cod_amount ?? null,
        booked_at: row.booked_at || "",
        orders: { order_number: row.orderNumber ?? null },
        addresses: row.address ?? null,
      },
      sender,
      "KL TRENDS SP",
      1
    );
    expect(cells).toHaveLength(48);
    const bytes = await articleDetailsWorkbook([cells]);
    const sheets = await readWorkbook(bytes);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["ArticleDetails", "Information"]);
    expect(sheets[0]!.rows[0]).toEqual(ARTICLE_DETAILS_HEADERS.map((header) => header.trim()));
    expect(sheets[0]!.rows[1]![1]).toBe(BARCODE);
    expect(sheets[0]!.rows[1]![16]).toBe("cod");
    expect(sheets[0]!.rows[1]![17]).toBe("1199");
    expect(sheets[0]!.rows[1]![24]).toBe("0");
    expect(sheets[0]!.rows[1]![47]).toBe("");

    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const information = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
    expect(sheet).toContain("LENGTH ");
    expect(information).toContain("INSTRICTION RTS");
    expect(sheet).toContain('<c r="D2" t="b"><v>0</v></c>');
    expect(sheet).toContain('<c r="E2" t="b"><v>0</v></c>');
    expect(sheet).toContain('<c r="L2" t="b"><v>0</v></c>');
    expect(sheet).toContain('<c r="Y2" t="b"><v>0</v></c>');
    expect(sheet).toContain('<c r="G2" t="str"><v>700162</v></c>');
    expect(sheet).toContain('<c r="M2" t="str"><v>8089117541</v></c>');
    expect(sheet).toContain('<c r="N2" t="str"><v>7998188311</v></c>');
    expect(sheet).toContain('<c r="Q2" t="str"><v>cod</v></c>');
    expect(sheet).toContain('<c r="R2" s="1"><v>1199</v></c>');
  });

  it("does not import the booking provider or barcode allocator", () => {
    const source = readFileSync(new URL("./india-post-excel.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/india-post\/provider|allocate-barcode|booking-run/);
  });
});
