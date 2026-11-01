import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import { mergeSameSizePdfs, parseBulkPrintIds } from "@/modules/labels/bulk-slip-print";

const printCalls: Array<{ copies?: number; paperSize?: string }> = [];
const memberInserts: unknown[] = [];
let officialReady = true;
let missingBarcode = false;

async function pdfAt(width: number, height: number) {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return new Uint8Array(await doc.save());
}

vi.mock("@/modules/labels/custom-label-service", () => ({
  renderCustomShippingLabel: vi.fn(async (_supabase: unknown, _org: string, input: { shipmentId: string }) => ({
    shipmentId: input.shipmentId,
    orderId: `ord-${input.shipmentId}`,
    template: {
      templateVersion: 1,
      page: { paperSize: "4x6", widthPt: 288, heightPt: 432, widthMm: 102, heightMm: 152 },
      elements: {},
    },
    data: {},
    pdf: Buffer.from(await pdfAt(288, 432)),
  })),
}));

vi.mock("@/modules/labels/persist", () => ({
  persistLabelPdf: vi.fn(async () => ({
    id: "merged-label",
    file_path: "org/merged.pdf",
    file_url: null,
    kind: "CUSTOM_SHIPPING",
  })),
}));

vi.mock("@/modules/print/service", () => ({
  getPrintStation: vi.fn(async () => ({ connected: true })),
  enqueueManualPrintJob: vi.fn(async (_supabase: unknown, _ctx: unknown, _labelId: string, options?: { copies?: number; paperSize?: string }) => {
    printCalls.push({ copies: options?.copies, paperSize: options?.paperSize });
    return { id: "job-1", status: "PENDING", source: "MANUAL", delivery: "POLL" };
  }),
}));

vi.mock("@/modules/labels/template-service", () => ({
  getLabelTemplate: vi.fn(async () => ({
    templateVersion: 1,
    page: { paperSize: "4x6", widthPt: 288, heightPt: 432, widthMm: 102, heightMm: 152 },
    elements: {},
  })),
}));

vi.mock("@/modules/labels/sheet-members", () => ({
  insertLabelSheetMembers: vi.fn(async (_supabase: unknown, input: { members: unknown[] }) => {
    memberInserts.push(...input.members);
    return input.members;
  }),
}));

function supabase() {
  return {
    from(table: string) {
      const state: { kind?: string } = {};
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          if (column === "kind") state.kind = value;
          return api;
        },
        in() {
          return api;
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          if (table === "shipments") {
            return Promise.resolve({
              data: [
                { id: "ship-a", barcode: missingBarcode ? null : "AA", booked_at: missingBarcode ? null : "2026-01-01" },
                { id: "ship-b", barcode: "BB", booked_at: "2026-01-01" },
                { id: "ship-c", barcode: "CC", booked_at: "2026-01-01" },
              ],
              error: null,
            }).then(resolve);
          }
          if (table === "labels" && state.kind === "INDIA_POST") {
            return Promise.resolve({
              data: officialReady
                ? [
                    { id: "ip-a", shipment_id: "ship-a" },
                    { id: "ip-b", shipment_id: "ship-b" },
                    { id: "ip-c", shipment_id: "ship-c" },
                  ]
                : [],
              error: null,
            }).then(resolve);
          }
          if (table === "labels") {
            return Promise.resolve({
              data: [
                { id: "lab-a", shipment_id: "ship-a" },
                { id: "lab-b", shipment_id: "ship-b" },
                { id: "lab-c", shipment_id: "ship-c" },
              ],
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return api;
    },
  };
}

const ctx = { organizationId: "org-a", userId: "user-a", role: "OWNER" } as TenantContext;

describe("mergeSameSizePdfs", () => {
  it("keeps 4x6 page size across slips", async () => {
    const merged = await mergeSameSizePdfs([await pdfAt(288, 432), await pdfAt(288, 432)]);
    expect(merged.pageCount).toBe(2);
    expect(merged.widthPt).toBe(288);
    expect(merged.heightPt).toBe(432);
    const loaded = await PDFDocument.load(merged.pdf);
    expect(loaded.getPage(0).getWidth()).toBe(288);
    expect(loaded.getPage(1).getHeight()).toBe(432);
  });

  it("rejects mixed page sizes", async () => {
    await expect(mergeSameSizePdfs([await pdfAt(288, 432), await pdfAt(595, 842)])).rejects.toMatchObject({
      message: expect.stringMatching(/same paper size/i),
    });
  });

  it("rejects an empty list", async () => {
    await expect(mergeSameSizePdfs([])).rejects.toBeInstanceOf(AppError);
    await expect(mergeSameSizePdfs([])).rejects.toMatchObject({
      message: "Select shipping slips to print.",
    });
  });
});

describe("parseBulkPrintIds", () => {
  it("dedupes and drops blanks", () => {
    expect(parseBulkPrintIds([" a ", "a", "", "b"])).toEqual(["a", "b"]);
    expect(parseBulkPrintIds(null)).toEqual([]);
  });
});

describe("prepareBulkShippingSlips", () => {
  beforeEach(() => {
    officialReady = true;
    missingBarcode = false;
  });

  it("merges one 4x6 page per shipment", async () => {
    const { prepareBulkShippingSlips } = await import("@/modules/labels/bulk-slip-print");
    const prepared = await prepareBulkShippingSlips(supabase() as never, ctx, ["lab-a", "lab-b", "lab-c"]);
    expect(prepared.shipmentIds).toEqual(["ship-a", "ship-b", "ship-c"]);
    expect(prepared.merged.pageCount).toBe(3);
    expect(prepared.merged.widthPt).toBe(288);
    expect(prepared.merged.heightPt).toBe(432);
    const loaded = await PDFDocument.load(prepared.merged.pdf);
    expect(loaded.getPageCount()).toBe(3);
    expect(loaded.getPage(0).getWidth()).toBe(288);
    expect(loaded.getPage(2).getHeight()).toBe(432);
  });

  it("fails when a barcode is not ready", async () => {
    missingBarcode = true;
    officialReady = false;
    const { prepareBulkShippingSlips } = await import("@/modules/labels/bulk-slip-print");
    await expect(prepareBulkShippingSlips(supabase() as never, ctx, ["lab-a", "lab-b"])).rejects.toMatchObject({
      message: "Generate the India Post label first.",
    });
  });
});

describe("printBulkShippingSlips", () => {
  beforeEach(() => {
    printCalls.length = 0;
    memberInserts.length = 0;
    officialReady = true;
    missingBarcode = false;
  });

  it("enqueues one print job for three slips", async () => {
    const { printBulkShippingSlips } = await import("@/modules/labels/bulk-slip-print");
    const printed = await printBulkShippingSlips(supabase() as never, ctx, ["lab-a", "lab-b", "lab-c"], {
      idempotencyKey: "bulk-1",
    });
    expect(printed.slipCount).toBe(3);
    expect(printed.pageCount).toBe(3);
    expect(printed.labelId).toBe("merged-label");
    expect(printCalls).toEqual([{ copies: 1, paperSize: "4x6" }]);
    expect(memberInserts).toHaveLength(3);
  });

  it("fails the batch when a barcode is not ready", async () => {
    missingBarcode = true;
    officialReady = false;
    const { printBulkShippingSlips } = await import("@/modules/labels/bulk-slip-print");
    await expect(printBulkShippingSlips(supabase() as never, ctx, ["lab-a", "lab-b"])).rejects.toMatchObject({
      message: "Generate the India Post label first.",
    });
    expect(printCalls).toEqual([]);
  });

  it("throws when no ids are selected", async () => {
    const { printBulkShippingSlips } = await import("@/modules/labels/bulk-slip-print");
    await expect(printBulkShippingSlips(supabase() as never, ctx, [])).rejects.toMatchObject({
      message: "Select shipping slips to print.",
    });
  });
});
