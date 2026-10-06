import { describe, expect, it, vi } from "vitest";
import { splitIndiaPostBookingResult } from "@/modules/india-post/booking-apply";
import {
  isAuthoritativeIndiaPostBooking,
  isIndiaPostBookingUnknown,
  trackingHasArticle,
} from "@/modules/india-post/booking-idempotency";
import { isIndiaPostDuplicateArticleMessage } from "@/modules/india-post/error-text";
import { runIndiaPostBooking } from "@/modules/india-post/booking-run";
import { markShipmentBookingFailed } from "@/modules/india-post/booking-run";

const bookShipmentMock = vi.fn();
const trackShipmentMock = vi.fn();

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(() => ({
    ensureSession: vi.fn().mockResolvedValue({ reused: true, tokens: null }),
    bookShipment: (...args: unknown[]) => bookShipmentMock(...args),
    bookShipmentFile: (...args: unknown[]) => bookShipmentMock(...args),
    trackShipment: (...args: unknown[]) => trackShipmentMock(...args),
    searchPostOffices: vi.fn().mockResolvedValue([
      { office_id: "22660454", delivery_office_flag: true, pincode: "682311" },
    ]),
  })),
}));

vi.mock("@/modules/india-post/origin", () => ({
  cachedOfficeLookup: vi.fn(),
  resolveIndiaPostOrigin: vi.fn().mockResolvedValue({
    officeId: "22660454",
    pincode: "682311",
    city: "Ernakulam",
    state: "Kerala",
  }),
}));

const BARCODE = "ET214330016IN";

function baseShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship-1",
    organization_id: "org-1",
    order_id: "ord-1",
    status: "QUEUED",
    barcode: BARCODE,
    booked_at: null,
    tracking_number: null,
    service_code: "SP_INLAND_PARCEL",
    weight_grams: 500,
    length_cm: 20,
    width_cm: 15,
    height_cm: 10,
    payment_mode: "PREPAID",
    cod_amount: 0,
    orders: { id: "ord-1", order_number: "#1001", source: "SHOPIFY" },
    customers: { name: "Test", phone: "9876543210" },
    addresses: {
      name: "Test",
      line1: "123 St",
      city: "Delhi",
      state: "Delhi",
      pincode: "110001",
      phone: "9876543210",
    },
    ...overrides,
  };
}

function ceptSuccess() {
  return {
    batch_id: "batch-1",
    correlation_id: "corr-1",
    valid_articles: [{ barcode_no: BARCODE, article_number: BARCODE, calculated_tariff: 45 }],
    error_articles: [],
  };
}

function memoryDb(rows: Record<string, unknown>[]) {
  const store = rows.map((row) => ({ ...row }));
  const matches = (row: Record<string, unknown>, filters: Array<{ op: string; key: string; value: unknown }>) =>
    filters.every((filter) => {
      if (filter.op === "eq") return row[filter.key] === filter.value;
      if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.key]);
      if (filter.op === "is") return row[filter.key] == null && filter.value == null;
      return true;
    });

  const write = (patch: Record<string, unknown>) => {
    const filters: Array<{ op: string; key: string; value: unknown }> = [];
    const chain: Record<string, unknown> = {};
    const next = () => chain;
    chain.eq = (key: string, value: unknown) => {
      filters.push({ op: "eq", key, value });
      return chain;
    };
    chain.in = (key: string, value: unknown) => {
      filters.push({ op: "in", key, value });
      return chain;
    };
    chain.is = (key: string, value: unknown) => {
      filters.push({ op: "is", key, value });
      return chain;
    };
    const apply = () => {
      const row = store.find((item) => matches(item, filters));
      if (!row) return { data: null, error: null };
      Object.assign(row, patch);
      return { data: { ...row }, error: null };
    };
    chain.select = next;
    chain.maybeSingle = async () => apply();
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(apply()).then(resolve, reject);
    return chain;
  };

  const supabase = {
    from: (table: string) => {
      if (table === "india_post_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "conn-1",
                  status: "CONNECTED",
                  environment: "TEST",
                  bulk_customer_id: "1788590988",
                  contract_id: "41793509",
                },
              }),
            }),
          }),
        };
      }
      if (table === "shipments") {
        return {
          select: () => ({
            eq: (key: string, value: unknown) => ({
              in: async (_idsKey: string, ids: string[]) => ({
                data: store.filter((row) => row[key] === value && ids.includes(String(row.id))),
              }),
              maybeSingle: async () => ({ data: store.find((row) => row[key] === value) ?? null }),
            }),
          }),
          update: write,
        };
      }
      if (table === "orders") {
        return { update: () => ({ eq: async () => ({}) }) };
      }
      if (table === "pickup_locations") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      name: "WH",
                      pincode: "682311",
                      city: "Ernakulam",
                      state: "Kerala",
                      line1: "Line",
                      phone: "9876543210",
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  name: "Org",
                  phone: "9876543210",
                  line1: "Line",
                  city: "Ernakulam",
                  state: "Kerala",
                  pincode: "682311",
                },
              }),
            }),
          }),
        };
      }
      if (table === "shopify_stores") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { shop_name: "Shop" } }) }) }) };
      }
      if (table === "india_post_contracts") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [{ service_code: "SP_INLAND_PARCEL", contract_id: "41793509" }] }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  };
  return { supabase, store };
}

describe("booking idempotency helpers", () => {
  it("treats booked_at + barcode as booked even when status is FAILED", () => {
    expect(
      isAuthoritativeIndiaPostBooking({
        status: "FAILED",
        barcode: BARCODE,
        booked_at: "2026-10-06T06:39:39.000Z",
      })
    ).toBe(true);
  });

  it("detects unknown in-flight BOOKING", () => {
    expect(isIndiaPostBookingUnknown({ status: "BOOKING", barcode: BARCODE, booked_at: null })).toBe(true);
  });

  it("detects duplicate article copy", () => {
    expect(isIndiaPostDuplicateArticleMessage("Duplicate article: Already booked today or yesterday")).toBe(true);
  });

  it("maps duplicate CEPT article errors onto valid outcomes", () => {
    const split = splitIndiaPostBookingResult({
      error_articles: [{ barcode_no: BARCODE, errors: ["Duplicate article: Already booked today or yesterday"] }],
    });
    expect(split.valid.get(BARCODE)?.duplicate).toBe(true);
    expect(split.failed.size).toBe(0);
  });

  it("matches tracking by article number", () => {
    expect(
      trackingHasArticle({ data: [{ booking_details: { article_number: BARCODE } }] }, BARCODE)
    ).toBe(true);
  });
});

describe("runIndiaPostBooking idempotency", () => {
  it("TEST 1 normal booking makes one CEPT call", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    trackShipmentMock.mockReset();
    const { supabase, store } = memoryDb([baseShipment()]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.status).toBe("BOOKED");
    expect(store[0]?.booked_at).toBeTruthy();
  });

  it("TEST 2 already BOOKED makes zero CEPT calls", async () => {
    bookShipmentMock.mockReset();
    const { supabase } = memoryDb([
      baseShipment({ status: "BOOKED", booked_at: "2026-10-06T06:00:00.000Z" }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  it("TEST 3 retry after BOOKED makes zero CEPT calls", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase } = memoryDb([baseShipment()]);
    await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
  });

  it("TEST 4 two workers race: one CEPT call", async () => {
    bookShipmentMock.mockReset().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(ceptSuccess()), 30))
    );
    const { supabase } = memoryDb([baseShipment()]);
    const [a, b] = await Promise.allSettled([
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] }),
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] }),
    ]);
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    const booked = [a, b].filter((result) => result.status === "fulfilled");
    expect(booked.length).toBeGreaterThanOrEqual(1);
  });

  it("TEST 5 CEPT success then persistence failure does not book again", async () => {
    bookShipmentMock.mockReset().mockResolvedValue(ceptSuccess());
    trackShipmentMock.mockReset().mockResolvedValue({ data: [] });
    const { supabase, store } = memoryDb([baseShipment()]);
    await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    store[0]!.status = "BOOKING";
    store[0]!.booked_at = null;
    store[0]!.tracking_number = null;
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
  });

  it("TEST 6 duplicate CEPT response is not generic FAILED", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce({
      error_articles: [{ barcode_no: BARCODE, errors: ["Duplicate article: Already booked today or yesterday"] }],
    });
    const { supabase, store } = memoryDb([baseShipment()]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.status).toBe("BOOKED");
    expect(store[0]?.booked_at).toBeTruthy();
  });

  it("TEST 7 late failure cannot overwrite BOOKED", async () => {
    const { supabase, store } = memoryDb([
      baseShipment({ status: "BOOKED", booked_at: "2026-10-06T06:00:00.000Z" }),
    ]);
    await markShipmentBookingFailed(supabase as never, "ship-1", "stale", "VALIDATION_ERROR", "org-1");
    expect(store[0]?.status).toBe("BOOKED");
    expect(store[0]?.booked_at).toBe("2026-10-06T06:00:00.000Z");
  });

  it("TEST 8 timeout after CEPT does not submit again", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    bookShipmentMock.mockReset().mockRejectedValueOnce(timeout);
    trackShipmentMock.mockReset().mockResolvedValue({ data: [] });
    const { supabase, store } = memoryDb([baseShipment()]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(store[0]?.status).toBe("BOOKING");
    expect(store[0]?.booked_at).toBeNull();
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
  });

  it("TEST 9 pre-CEPT validation failure can retry CEPT later", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase, store } = memoryDb([
      baseShipment({
        addresses: {
          name: "Test",
          line1: "123 St",
          city: "Delhi",
          state: "Delhi",
          pincode: "12",
          phone: "9876543210",
        },
      }),
    ]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toThrow();
    expect(bookShipmentMock).not.toHaveBeenCalled();
    store[0] = baseShipment({ status: "FAILED", booked_at: null });
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  it("TEST 10 tenant isolation keeps the same barcode on another org bookable", async () => {
    bookShipmentMock.mockReset().mockResolvedValue(ceptSuccess());
    const { supabase } = memoryDb([
      baseShipment({ organization_id: "org-a", status: "BOOKED", booked_at: "2026-10-06T06:00:00.000Z" }),
      baseShipment({ id: "ship-2", organization_id: "org-b", status: "QUEUED" }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-b",
      shipmentIds: ["ship-2"],
    });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-2"]);
  });
});
