import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { TenantContext } from "@/lib/api/context";

const persisted: Array<{ shipmentId: string; snapshot: unknown }> = [];
const memberInserts: unknown[] = [];
const printCalls: Array<{ copies?: number }> = [];
let enqueueError: Error | null = null;
let persistError: Error | null = null;
const idempotency = new Map<string, { response: unknown; created_at: string }>();

async function tinyPdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return new Uint8Array(await doc.save());
}

vi.mock("@/modules/labels/custom-label-service", () => ({
  loadCustomShippingLabel: vi.fn(async (_supabase: unknown, organizationId: string, input: { orderId: string }) => {
    if (organizationId !== "org-a") throw new Error("Order not found.");
    if (input.orderId.startsWith("other-")) throw new Error("Order not found.");
    return {
      shipmentId: `ship-${input.orderId}`,
      orderId: `ord-${input.orderId}`,
      template: {
        templateVersion: 1,
        page: { paperSize: "A6", widthPt: 298, heightPt: 420, widthMm: 105, heightMm: 148 },
        elements: {},
      },
      data: {},
    };
  }),
}));

vi.mock("@/modules/labels/packing-pdf", () => ({
  renderMerchantLabelPdf: vi.fn(async () => tinyPdf()),
}));

vi.mock("@/modules/labels/multi-up/pdf", () => ({
  composeMultiUpPdf: vi.fn(async () => tinyPdf()),
}));

vi.mock("@/modules/labels/persist", () => ({
  persistLabelPdf: vi.fn(async (_supabase: unknown, input: { shipmentId: string; templateSnapshot?: unknown }) => {
    if (persistError) throw persistError;
    persisted.push({ shipmentId: input.shipmentId, snapshot: input.templateSnapshot });
    return { id: "sheet-label", file_path: "org/sheet.pdf", file_url: null, kind: "CUSTOM_SHIPPING" };
  }),
}));

vi.mock("@/modules/print/service", () => ({
  getPrintStation: vi.fn(async () => ({ connected: true, paperSize: "A4" })),
  enqueueManualPrintJob: vi.fn(async () => {
    if (enqueueError) throw enqueueError;
    printCalls.push({ copies: 1 });
    return { id: "job-1", status: "PENDING", source: "MANUAL" };
  }),
}));

vi.mock("@/modules/labels/template-service", () => ({
  getLabelTemplate: vi.fn(async () => ({
    templateVersion: 1,
    page: { paperSize: "A6", widthPt: 298, heightPt: 420, widthMm: 105, heightMm: 148 },
    elements: {},
  })),
}));

vi.mock("@/modules/labels/sheet-members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/labels/sheet-members")>();
  return {
    ...actual,
    insertLabelSheetMembers: vi.fn(async (_supabase: unknown, input: { members: unknown[] }) => {
      memberInserts.push(...input.members);
      return input.members;
    }),
  };
});

function supabase() {
  return {
    from(table: string) {
      const state: { eq: Record<string, string>; update?: { response?: unknown } } = { eq: {} };
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          state.eq[column] = value;
          if (state.update && table === "idempotency_keys" && state.eq.key && idempotency.has(state.eq.key)) {
            const current = idempotency.get(state.eq.key)!;
            idempotency.set(state.eq.key, { ...current, response: state.update.response });
          }
          return api;
        },
        update(row: { response?: unknown }) {
          state.update = row;
          return api;
        },
        delete() {
          return api;
        },
        insert(row: { key?: string; organization_id?: string }) {
          if (table === "idempotency_keys" && row.key) {
            if (idempotency.has(row.key)) {
              return {
                then: (resolve: (value: { error: { code: string } }) => unknown) =>
                  Promise.resolve({ error: { code: "23505" } }).then(resolve),
              };
            }
            idempotency.set(row.key, { response: null, created_at: new Date().toISOString() });
          }
          return {
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
        },
        maybeSingle: async () => {
          if (table === "idempotency_keys") {
            const key = state.eq.key;
            const row = key ? idempotency.get(key) : null;
            return { data: row ?? null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (value: { data: null; error: null }) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return api;
    },
  };
}

const ctx = { organizationId: "org-a", userId: "user-a", role: "OWNER" } as TenantContext;

describe("printMultiUpSheet persistence", () => {
  beforeEach(() => {
    persisted.length = 0;
    memberInserts.length = 0;
    printCalls.length = 0;
    enqueueError = null;
    persistError = null;
    idempotency.clear();
  });

  it("associates every order shipment on a two-order sheet", async () => {
    const { printMultiUpSheet } = await import("@/modules/labels/multi-up/render");
    const printed = await printMultiUpSheet(
      supabase() as never,
      ctx,
      {
        disposition: "print",
        items: [
          { orderId: "A", copies: 1 },
          { orderId: "B", copies: 1 },
        ],
        sheet: { paperSize: "A4" },
      }
    );
    expect(printed.labelId).toBe("sheet-label");
    expect(persisted[0]?.shipmentId).toBe("ship-A");
    expect(memberInserts).toEqual([
      expect.objectContaining({ shipmentId: "ship-A", orderId: "A" }),
      expect.objectContaining({ shipmentId: "ship-B", orderId: "B" }),
    ]);
    expect(printCalls).toEqual([{ copies: 1 }]);
  });

  it("rejects another organization's order IDs before persist", async () => {
    const { printMultiUpSheet } = await import("@/modules/labels/multi-up/render");
    await expect(
      printMultiUpSheet(supabase() as never, { ...ctx, organizationId: "org-b" }, {
        items: [{ orderId: "A", copies: 1 }],
        sheet: { paperSize: "A4" },
      })
    ).rejects.toThrow(/Order not found/);
    expect(persisted).toEqual([]);
    expect(printCalls).toEqual([]);
  });

  it("does not create a print job when PDF persist fails", async () => {
    persistError = new Error("Could not save the label.");
    const { printMultiUpSheet } = await import("@/modules/labels/multi-up/render");
    await expect(
      printMultiUpSheet(supabase() as never, ctx, {
        items: [{ orderId: "A", copies: 1 }],
        sheet: { paperSize: "A4" },
      })
    ).rejects.toThrow(/Could not save/);
    expect(printCalls).toEqual([]);
    expect(memberInserts).toEqual([]);
  });

  it("does not report success when enqueue fails after persist", async () => {
    enqueueError = new Error("Could not queue a reprint.");
    const { printMultiUpSheet } = await import("@/modules/labels/multi-up/render");
    await expect(
      printMultiUpSheet(supabase() as never, ctx, {
        items: [{ orderId: "A", copies: 1 }],
        sheet: { paperSize: "A4" },
      })
    ).rejects.toThrow(/queue a reprint/);
  });

  it("returns the first job for a duplicate idempotency key", async () => {
    const { printMultiUpSheet } = await import("@/modules/labels/multi-up/render");
    const body = { items: [{ orderId: "A", copies: 1 }], sheet: { paperSize: "A4" } };
    await printMultiUpSheet(supabase() as never, ctx, body, { idempotencyKey: "click-1" });
    const second = await printMultiUpSheet(supabase() as never, ctx, body, { idempotencyKey: "click-1" });
    expect(printCalls).toHaveLength(1);
    expect(second.labelId).toBe("sheet-label");
  });
});
