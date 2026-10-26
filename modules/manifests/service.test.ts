import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readWorkbook } from "@/lib/xlsx/read";
import { manifestCsv, manifestFileBase, manifestXlsx } from "@/modules/manifests/export";
import { paginateManifestRows, renderManifestPdf } from "@/modules/manifests/pdf";
import {
  assignToDraft,
  groupForManifests,
  isScanned,
  istDate,
  manifestTotals,
  resolveManifestOffice,
  type ManifestDetail,
  type ManifestLine,
} from "@/modules/manifests/service";

const connection = {
  pickup_dropoff_office_id: "22660454",
  pickup_dropoff_office_name: "Kolenchery SO",
  pickup_office_id: "22660001",
  pickup_office_name: "Ernakulam HO",
};

function line(overrides: Partial<ManifestLine> = {}): ManifestLine {
  return {
    shipmentId: crypto.randomUUID(),
    barcode: "EL123456789IN",
    orderNumber: "PB-1001",
    consignee: "Asha Menon",
    city: "Kochi",
    pincode: "682311",
    serviceCode: "SP_INLAND_PARCEL",
    serviceLabel: "Speed Post Parcel",
    weightGrams: 500,
    paymentMode: "PREPAID",
    codAmount: 0,
    tariffAmount: 61,
    shipmentStatus: "MANIFEST_READY",
    addedAt: "2026-10-27T05:00:00Z",
    scanned: null,
    ...overrides,
  };
}

function detail(lines: ManifestLine[], overrides: Partial<ManifestDetail> = {}): ManifestDetail {
  return {
    id: crypto.randomUUID(),
    name: "Manifest 2026-10-27",
    number: "MF-20261027-22660454-01",
    status: "CLOSED",
    date: "2026-10-27",
    officeId: "22660454",
    officeName: "Kolenchery SO",
    shipmentCount: lines.length,
    createdAt: "2026-10-27T05:00:00Z",
    closedAt: "2026-10-27T10:00:00Z",
    reopenedAt: null,
    handedOverAt: null,
    handedOverTo: null,
    handoverNotes: null,
    hasProof: false,
    lines,
    totals: manifestTotals(lines),
    unscannedCount: 0,
    ...overrides,
  };
}

describe("manifest grouping", () => {
  it("uses the IST calendar day, not UTC", () => {
    expect(istDate(new Date("2026-10-26T18:29:59Z"))).toBe("2026-10-26");
    expect(istDate(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-27");
  });

  it("prefers the booked office, then the drop-off, then the pickup office", () => {
    expect(resolveManifestOffice("22660001", connection)).toEqual({ id: "22660001", name: "Ernakulam HO" });
    expect(resolveManifestOffice(null, connection)).toEqual({ id: "22660454", name: "Kolenchery SO" });
    expect(resolveManifestOffice(null, { pickup_office_id: "22660001", pickup_office_name: "Ernakulam HO" })).toEqual({
      id: "22660001",
      name: "Ernakulam HO",
    });
    expect(resolveManifestOffice("99999999", connection)).toEqual({ id: "99999999", name: null });
    expect(resolveManifestOffice(null, null)).toEqual({ id: null, name: null });
  });

  it("groups shipments per booking office for the day", () => {
    const groups = groupForManifests(
      [
        { id: "a", booking_office_id: "22660454" },
        { id: "b", booking_office_id: null },
        { id: "c", booking_office_id: "22660001" },
      ],
      connection,
      "2026-10-27"
    );
    expect(groups.map((group) => [group.office.id, group.shipmentIds])).toEqual([
      ["22660454", ["a", "b"]],
      ["22660001", ["c"]],
    ]);
  });
});

describe("assignToDraft", () => {
  function fakeSupabase(rpcRows: Array<{ manifest_id: string; shipment_id: string }>) {
    const calls: Array<Record<string, unknown>> = [];
    const chain = (data: unknown) => {
      const api: Record<string, unknown> = {};
      for (const name of ["select", "eq", "in"]) api[name] = () => api;
      api.maybeSingle = async () => ({ data, error: null });
      api.then = (resolve: (value: unknown) => void) => resolve({ data, error: null });
      return api;
    };
    return {
      calls,
      client: {
        from(table: string) {
          if (table === "shipments") {
            return chain([
              { id: "11111111-1111-4111-8111-111111111111", booking_office_id: "22660454" },
              { id: "22222222-2222-4222-8222-222222222222", booking_office_id: "22660001" },
            ]);
          }
          return chain(connection);
        },
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, ...args });
          const ids = args.p_shipment_ids as string[];
          return { data: rpcRows.filter((row) => ids.includes(row.shipment_id)), error: null };
        },
      },
    };
  }

  it("calls the RPC once per office for today's IST date and returns only new links", async () => {
    const fake = fakeSupabase([
      { manifest_id: "m1", shipment_id: "11111111-1111-4111-8111-111111111111" },
    ]);
    const result = await assignToDraft(
      fake.client as never,
      "org",
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "not-a-uuid"],
      { now: new Date("2026-10-26T20:00:00Z") }
    );
    expect(fake.calls).toEqual([
      expect.objectContaining({ name: "manifest_add_shipments", p_date: "2026-10-27", p_office_id: "22660454", p_office_name: "Kolenchery SO" }),
      expect.objectContaining({ name: "manifest_add_shipments", p_date: "2026-10-27", p_office_id: "22660001", p_office_name: "Ernakulam HO" }),
    ]);
    // The second shipment was already on a manifest: it is not reported as added.
    expect(result).toEqual({ added: ["11111111-1111-4111-8111-111111111111"], manifestIds: ["m1"] });
  });
});

describe("manifest totals and scan state", () => {
  it("sums weight, COD and per-service counts", () => {
    const totals = manifestTotals([
      line({ weightGrams: 500 }),
      line({ weightGrams: 1200, paymentMode: "COD", codAmount: 799.5 }),
      line({ weightGrams: 300, serviceCode: "BUSINESS_PARCEL", serviceLabel: "Business Parcel", tariffAmount: null }),
    ]);
    expect(totals).toMatchObject({ count: 3, weightGrams: 2000, codCount: 1, codAmount: 799.5, tariffAmount: 122 });
    expect(totals.byService).toEqual([
      { code: "SP_INLAND_PARCEL", label: "Speed Post Parcel", count: 2, weightGrams: 1700 },
      { code: "BUSINESS_PARCEL", label: "Business Parcel", count: 1, weightGrams: 300 },
    ]);
  });

  it("treats an India Post event or movement past pickup as scanned", () => {
    expect(isScanned("MANIFEST_READY", false)).toBe(false);
    expect(isScanned("MANIFEST_READY", true)).toBe(true);
    expect(isScanned("IN_TRANSIT", false)).toBe(true);
    expect(isScanned("DELIVERED", false)).toBe(true);
  });
});

describe("manifest exports", () => {
  it("writes CSV with BOM, CRLF, quoting and formula neutralising", () => {
    const csv = manifestCsv(detail([line({ consignee: 'Menon, "Asha"', orderNumber: "=HYPERLINK(1)" })]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = csv.slice(1).split("\r\n");
    expect(rows[0]).toBe("S.No,Barcode,Order,Consignee,City,Pincode,Service,Weight (g),Payment,COD amount,Tariff");
    expect(rows[1]).toBe(`1,EL123456789IN,'=HYPERLINK(1),"Menon, ""Asha""",Kochi,682311,Speed Post Parcel,500,PREPAID,0,61`);
  });

  it("round-trips XLSX rows and a summary sheet", async () => {
    const bytes = await manifestXlsx(detail([line(), line({ barcode: "EL000000002IN", consignee: "ആശ" })]));
    const sheets = await readWorkbook(bytes);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Manifest", "Summary"]);
    expect(sheets[0].rows[2].slice(0, 4)).toEqual(["2", "EL000000002IN", "PB-1001", "ആശ"]);
    expect(sheets[1].rows[0]).toEqual(["Manifest", "MF-20261027-22660454-01"]);
  });

  it("names draft files without a number", () => {
    expect(manifestFileBase({ number: null, date: "2026-10-27", officeId: null })).toBe("MF-DRAFT-20261027-NA");
  });
});

describe("manifest PDF", () => {
  it("keeps room for the footer on the last page", () => {
    expect(paginateManifestRows(10, 8)).toEqual([10]);
    expect(paginateManifestRows(40, 8)).toEqual([39, 1]);
    expect(paginateManifestRows(120, 8)).toEqual([40, 47, 33]);
    expect(paginateManifestRows(0, 8)).toEqual([0]);
  });

  it("paginates large manifests instead of overflowing one page", async () => {
    const lines = Array.from({ length: 130 }, (_, index) =>
      line({ barcode: `EL${String(index).padStart(9, "0")}IN`, consignee: index % 2 ? "राम कुमार" : "Asha Menon" })
    );
    const bytes = await renderManifestPdf(detail(lines), { name: "Lumin Ads", customerId: "1000012345" });
    const pdf = await PDFDocument.load(bytes);
    // 7 footer rows: 40 + 47 + 42 + 1.
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getTitle()).toContain("MF-20261027-22660454-01");
  });

  it("renders an empty draft", async () => {
    const bytes = await renderManifestPdf(detail([], { status: "DRAFT", number: null }), { name: "Lumin Ads", customerId: null });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
