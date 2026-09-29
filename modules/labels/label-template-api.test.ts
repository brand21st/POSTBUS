import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import { ptFromMm } from "@/modules/labels/layout/units";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { handleLabelTemplateRoutes } from "@/lib/api/v1/label-template";
import { indiaPostLabelTemplate, type LabelTemplate } from "@/modules/labels/template-schema";
import { createCustomTextElement } from "@/modules/labels/custom-blocks";

const encoded: string[] = [];
const persisted: Array<{ kind: string; shipmentId: string }> = [];
const snapshots: unknown[] = [];
const printCalls: Array<{ labelId: string; paperSize?: string; copies?: number }> = [];
let station: { connected: boolean; paperSize: string } = { connected: false, paperSize: "A4" };
const labelOps: Array<{ op: string; table: string }> = [];

vi.mock("@/modules/labels/india-post-barcode-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/labels/india-post-barcode-image")>();
  return {
    ...actual,
    indiaPostBarcodePng: async (articleId: string) => {
      encoded.push(articleId);
      return actual.indiaPostBarcodePng(articleId);
    },
  };
});

vi.mock("@/modules/labels/persist", () => ({
  persistLabelPdf: vi.fn(async (_supabase: unknown, input: { kind: string; shipmentId: string; templateSnapshot?: unknown }) => {
    persisted.push({ kind: input.kind, shipmentId: input.shipmentId });
    snapshots.push(input.templateSnapshot ?? null);
    return { id: "custom-label-1", file_path: "org/custom-label-1.pdf", file_url: null, kind: input.kind };
  }),
}));

vi.mock("@/modules/labels/load", () => ({
  loadLabelPdfBytes: vi.fn(async () => Buffer.from("%PDF-1.7 official-cept")),
}));

vi.mock("@/modules/print/service", () => ({
  enqueueManualPrintJob: vi.fn(async (_supabase: unknown, _ctx: unknown, labelId: string, opts?: { paperSize?: string; copies?: number }) => {
    printCalls.push({
      labelId,
      paperSize: opts?.paperSize,
      ...(opts?.copies != null ? { copies: opts.copies } : {}),
    });
    return { id: "job-1", status: "PENDING", source: "MANUAL" };
  }),
  getPrintStation: vi.fn(async () => station),
  updatePrintSettings: vi.fn(async () => null),
}));

const ctx = { organizationId: "org-a", userId: "user-a", role: "OWNER" } as TenantContext;

let template: LabelTemplate;
let shipment: Record<string, unknown>;
let labels: unknown = null;

function chain(table: string, data: unknown) {
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle: async () => ({ data, error: null }),
    single: async () => ({ data, error: null }),
    insert(row: Record<string, unknown>) {
      labelOps.push({ op: "insert", table });
      return { ...api, then: undefined, row };
    },
    update() {
      labelOps.push({ op: "update", table });
      return api;
    },
    delete() {
      labelOps.push({ op: "delete", table });
      return api;
    },
    upsert: async (row: { template?: LabelTemplate }) => {
      labelOps.push({ op: "upsert", table });
      if (table === "label_templates" && row.template) template = row.template;
      return { error: null };
    },
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      return Promise.resolve({
        data: Array.isArray(data) ? data : data == null ? [] : [data],
        error: null,
      }).then(resolve);
    },
  };
  return api;
}

function supabase() {
  return {
    from(table: string) {
      if (table === "label_templates") return chain(table, { template });
      if (table === "shipments") return chain(table, shipment);
      if (table === "orders") return chain(table, { id: "ord-1" });
      if (table === "organizations") {
        return chain(table, {
          name: "Prodinent Store",
          phone: "9999999999",
          line1: "Return Address",
          city: "Thrissur",
          state: "Kerala",
          pincode: "680001",
          logo_path: "org-a/logo-179.png",
        });
      }
      if (table === "order_line_items") {
        return chain(table, [{ title: "TEST 3", sku: null, quantity: 1, unit_price: 100 }]);
      }
      if (table === "labels") return chain(table, labels);
      if (table === "pickup_locations" || table === "shopify_stores") return chain(table, null);
      return chain(table, null);
    },
    storage: { from: () => ({ download: async () => ({ data: null }) }) },
  };
}

function call(method: string, path: string, body?: unknown, search?: string) {
  const request = new NextRequest(`http://localhost/api/v1/${path}${search ? `?${search}` : ""}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const slugs = path.split("/");
  return handleLabelTemplateRoutes(request, supabase() as never, ctx, `${method} ${path}`, method, slugs);
}

async function pdfBytes(result: unknown) {
  expect(result).toBeInstanceOf(Response);
  const bytes = Buffer.from(await (result as Response).arrayBuffer());
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  return bytes;
}

beforeEach(() => {
  encoded.length = 0;
  persisted.length = 0;
  snapshots.length = 0;
  printCalls.length = 0;
  labelOps.length = 0;
  labels = null;
  station = { connected: false, paperSize: "A4" };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  template = indiaPostLabelTemplate();
  shipment = {
    id: "ship-1",
    order_id: "ord-1",
    payment_mode: "COD",
    cod_amount: 1295,
    barcode: null,
    tracking_number: "CL626422400IN",
    service_code: "SP_INLAND_PARCEL",
    orders: {
      id: "ord-1",
      order_number: "246072",
      source_order_id: "246072",
      created_at: "2026-08-26T00:00:00.000Z",
      payment_status: "COD",
      subtotal: 100,
      discount: 0,
      shipping_amount: 0,
      total_amount: 100,
      metadata: {},
      shipping_address: {
        name: "Arjun A",
        line1: "Address lane 2",
        city: "Thrissur",
        state: "Kerala",
        pincode: "680303",
        phone: "918943697431",
      },
    },
    customers: { name: "Arjun A", phone: "918943697431" },
    addresses: {
      name: "Arjun A",
      line1: "Address lane 2",
      city: "Thrissur",
      state: "Kerala",
      pincode: "680303",
      phone: "918943697431",
    },
  };
});

describe("label template API", () => {
  it("saves and reloads the barcode block and the template library", async () => {
    template.elements.indiaPostBarcode = {
      ...template.elements.indiaPostBarcode,
      x: 422,
      y: 470,
      width: 280,
      height: 96,
      visible: true,
      align: "center",
      fontSize: 13,
      showArticleText: true,
    };
    template.library = [
      {
        id: "india-post",
        name: "India Post",
        isDefault: true,
        page: template.page,
        elements: template.elements,
      },
    ];
    await call("PUT", "label-template", { template });
    const loaded = (await call("GET", "label-template")) as { template: LabelTemplate; logoUrl?: string | null };
    expect(loaded.logoUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/organization-assets/org-a/logo-179.png"
    );
    expect(loaded.template.library?.[0].name).toBe("India Post");
    expect(loaded.template.library?.[0].elements.indiaPostBarcode).toMatchObject({
      x: 422,
      y: 470,
      width: 280,
      height: 96,
      visible: true,
      align: "center",
      fontSize: 13,
      showArticleText: true,
    });
  });

  it("reloads a version 4 template that has no barcode element", async () => {
    const legacy = defaultLegacy();
    await call("PUT", "label-template", { template: legacy });
    const loaded = (await call("GET", "label-template")) as { template: LabelTemplate };
    expect(loaded.template.elements.orderNumber.visible).toBe(true);
    expect(loaded.template.elements.indiaPostBarcode.visible).toBe(false);
  });

  it("renders the shipment article number and ignores a tracking number in the body", async () => {
    const preview = await call("POST", "label-template/custom-preview", {
      shipmentId: "ship-1",
      trackingNumber: "ET123456789IN",
      articleId: "ET123456789IN",
    });
    await pdfBytes(preview);
    expect(encoded).toEqual(["CL626422400IN"]);

    encoded.length = 0;
    shipment.tracking_number = "pending";
    shipment.barcode = "CL626422400IN";
    const download = await call("POST", "label-template/custom-download", {
      shipmentId: "ship-1",
      trackingNumber: "ET123456789IN",
    });
    await pdfBytes(download);
    expect(encoded).toEqual(["CL626422400IN"]);
  });

  it("still returns a PDF when the shipment has no article number", async () => {
    shipment.tracking_number = null;
    shipment.barcode = "not-valid";
    const preview = await call("POST", "label-template/custom-preview", {
      shipmentId: "ship-1",
      trackingNumber: "CL626422400IN",
    });
    await pdfBytes(preview);
    expect(encoded).toEqual([]);
  });

  it("prints a custom shipping label without replacing the other label files", async () => {
    const printed = (await call("POST", "label-template/custom-print", { shipmentId: "ship-1" })) as {
      labelId: string;
      downloadPath: string;
    };
    expect(printed.labelId).toBe("custom-label-1");
    expect(printed.downloadPath).toContain("custom-label-1");
    expect(persisted).toEqual([{ kind: "CUSTOM_SHIPPING", shipmentId: "ship-1" }]);
    expect(labelOps.some((op) => op.table === "labels" && (op.op === "delete" || op.op === "update"))).toBe(false);
  });

  it("uses the payment preview for COD and prepaid, and skips a hidden barcode", async () => {
    const cod = await call("POST", "label-template/custom-preview", { shipmentId: "ship-1", paymentPreview: "COD" });
    const prepaid = await call("POST", "label-template/custom-preview", {
      shipmentId: "ship-1",
      paymentPreview: "PREPAID",
    });
    const codBytes = await pdfBytes(cod);
    const prepaidBytes = await pdfBytes(prepaid);
    expect(Buffer.compare(codBytes, prepaidBytes)).not.toBe(0);

    encoded.length = 0;
    template.elements.indiaPostBarcode = { ...template.elements.indiaPostBarcode, visible: false };
    await pdfBytes(
      await call("POST", "label-template/custom-preview", {
        shipmentId: "ship-1",
        paymentPreview: "COD",
        template,
      })
    );
    await pdfBytes(
      await call("POST", "label-template/custom-preview", {
        shipmentId: "ship-1",
        paymentPreview: "PREPAID",
        template,
      })
    );
    expect(encoded).toEqual([]);
  });

  it("renders a sample custom preview PDF without a shipment", async () => {
    const preview = await call("POST", "label-template/custom-preview", { paymentPreview: "PREPAID" });
    const bytes = await pdfBytes(preview);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("returns custom preview data for a booked shipment", async () => {
    const loaded = (await call("GET", "label-template/custom-data", undefined, "shipmentId=ship-1")) as {
      preview: { orderNumber: string; customerId: string; items: Array<{ title: string }>; logoUrl?: string | null };
    };
    expect(loaded.preview.orderNumber).toBe("246072");
    expect(loaded.preview.items[0]?.title).toBe("TEST 3");
    expect(loaded.preview.customerId).toBe("");
    expect(loaded.preview.logoUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/organization-assets/org-a/logo-179.png"
    );
  });

  it("returns a barcode PNG for a valid article and an empty id otherwise", async () => {
    const png = await call("GET", "label-template/barcode", undefined, "shipmentId=ship-1");
    expect(png).toBeInstanceOf(Response);
    expect((png as Response).headers.get("Content-Type")).toContain("image/png");
    expect((await (png as Response).arrayBuffer()).byteLength).toBeGreaterThan(20);

    shipment.tracking_number = null;
    shipment.barcode = "not-valid";
    const empty = (await call("GET", "label-template/barcode", undefined, "shipmentId=ship-1")) as { articleId: string };
    expect(empty.articleId).toBe("");
  });

  it("saves an extra custom text block and reloads it", async () => {
    template.elements.customText2 = {
      ...createCustomTextElement(template.page, 1),
      visible: true,
      content: "Saved note",
    };
    await call("PUT", "label-template", { template });
    const loaded = (await call("GET", "label-template")) as { template: LabelTemplate };
    expect(loaded.template.elements.customText2).toMatchObject({ visible: true, content: "Saved note" });
  });

  it("stores the custom page snapshot when printing a custom label", async () => {
    await call("POST", "label-template/custom-print", { shipmentId: "ship-1" });
    expect(persisted.at(-1)).toEqual({ kind: "CUSTOM_SHIPPING", shipmentId: "ship-1" });
    expect(snapshots.at(-1)).toMatchObject({ page: { widthMm: 105, heightMm: 148 } });
    expect(printCalls.at(-1)?.paperSize).toBe("A6");
  });

  it("prints the official India Post label on A6 without a custom PDF", async () => {
    labels = [
      {
        id: "official-1",
        file_path: "org/official.pdf",
        file_url: null,
        shipment_id: "ship-1",
        kind: "INDIA_POST",
        status: "READY",
      },
    ];
    const preview = await call("POST", "label-template/preview");
    expect(preview).toBeInstanceOf(Response);
    expect(Buffer.from(await (preview as Response).arrayBuffer()).toString()).toContain("official-cept");

    persisted.length = 0;
    const printed = (await call("POST", "label-template/print-test", { copies: 1 })) as {
      job: { paperSize: string };
      labelId: string;
    };
    expect(printed.labelId).toBe("official-1");
    expect(printed.job.paperSize).toBe("A6");
    expect(printCalls.at(-1)).toMatchObject({ labelId: "official-1", paperSize: "A6" });
    expect(persisted).toEqual([]);
  });

  it("builds one A4 sheet from the stored label and ignores client page sizes", async () => {
    const result = await call("POST", "label-template/multi-sheet", {
      disposition: "inline",
      template: { page: { paperSize: "A4", widthPt: 10, heightPt: 10, widthMm: 10, heightMm: 10 } },
      items: [{ orderId: "246072", copies: 2 }],
      sheet: { paperSize: "A4", widthMm: 50, heightMm: 50, margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 }, gaps: { horizontalMm: 0, verticalMm: 0 }, rotation: 0, scale: 1 },
    });
    const bytes = await pdfBytes(result);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(ptFromMm(210), 2);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(ptFromMm(297), 2);
    expect((result as Response).headers.get("Content-Disposition")).toContain("inline");
  });

  it("builds a valid sheet when a slot is moved", async () => {
    const result = await call("POST", "label-template/multi-sheet", {
      disposition: "inline",
      items: [{ orderId: "246072", copies: 1 }],
      sheet: {
        paperSize: "A4",
        placements: [{ index: 0, xPt: 36, yPt: 48, widthPt: 180, heightPt: 260 }],
      },
    });
    const bytes = await pdfBytes(result);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(ptFromMm(210), 2);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(ptFromMm(297), 2);
  });

  it("prints the sheet only when the agent paper matches", async () => {
    await expect(
      call("POST", "label-template/multi-sheet", {
        disposition: "print",
        items: [{ orderId: "246072", copies: 1 }],
        sheet: { paperSize: "A4" },
      })
    ).rejects.toThrow(/Printer unavailable/);
    expect(printCalls).toEqual([]);

    station = { connected: true, paperSize: "4x6" };
    await expect(
      call("POST", "label-template/multi-sheet", {
        disposition: "print",
        items: [{ orderId: "246072", copies: 1 }],
        sheet: { paperSize: "A4" },
      })
    ).rejects.toThrow(/4x6/);
    expect(printCalls).toEqual([]);

    station = { connected: true, paperSize: "A4" };
    const printed = (await call("POST", "label-template/multi-sheet", {
      disposition: "print",
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { paperSize: "A4" },
    })) as { job: { paperSize: string } };
    expect(printed.job.paperSize).toBe("A4");
    expect(printCalls.at(-1)).toEqual({ labelId: "custom-label-1", paperSize: "A4", copies: 1 });
    expect(snapshots.at(-1)).toMatchObject({ page: { paperSize: "A4", widthMm: 210, heightMm: 297 } });
  });

  it("builds an A3 sheet from the preset and accepts A6 as a named sheet", async () => {
    const a6 = await call("POST", "label-template/multi-sheet", {
      disposition: "inline",
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { paperSize: "A6", widthMm: 10, heightMm: 10 },
    });
    const a6Pdf = await PDFDocument.load(await pdfBytes(a6));
    expect(a6Pdf.getPage(0).getWidth()).toBeCloseTo(ptFromMm(105), 2);
    expect(a6Pdf.getPage(0).getHeight()).toBeCloseTo(ptFromMm(148), 2);

    await expect(
      call("POST", "label-template/multi-sheet", {
        disposition: "inline",
        items: [{ orderId: "246072", copies: 1 }],
        sheet: { paperSize: "Letter" },
      })
    ).rejects.toThrow(/supported paper size/);

    const result = await call("POST", "label-template/multi-sheet", {
      disposition: "inline",
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { paperSize: "A3", widthMm: 50, heightMm: 50, margins: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 }, gaps: { horizontalMm: 0, verticalMm: 0 }, rotation: 0, scale: 1 },
    });
    const bytes = await pdfBytes(result);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(ptFromMm(297), 2);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(ptFromMm(420), 2);

    station = { connected: true, paperSize: "A3" };
    const printed = (await call("POST", "label-template/multi-sheet", {
      disposition: "print",
      items: [{ orderId: "246072", copies: 1 }],
      sheet: { paperSize: "A3" },
    })) as { job: { paperSize: string } };
    expect(printed.job.paperSize).toBe("A3");
    expect(printCalls.at(-1)).toMatchObject({ paperSize: "A3" });
    expect(snapshots.at(-1)).toMatchObject({ page: { paperSize: "A3", widthMm: 297, heightMm: 420 } });
  });
});

function defaultLegacy() {
  const current = indiaPostLabelTemplate();
  return {
    templateVersion: 4,
    page: { paperSize: "A4" as const, widthPt: 595.28, heightPt: 841.89 },
    elements: {
      orderNumber: {
        visible: true,
        x: 20,
        y: 700,
        width: 200,
        height: 20,
      },
    },
    library: current.library,
  };
}
