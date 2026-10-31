import { describe, expect, it, vi } from "vitest";
import { splitIndiaPostBookingResult } from "@/modules/india-post/booking-apply";
import {
  canRetryCeptPostAfterUnknown,
  isAuthoritativeIndiaPostBooking,
  isIndiaPostBookingUnknown,
  trackingHasArticle,
} from "@/modules/india-post/booking-idempotency";
import { isIndiaPostDuplicateArticleMessage } from "@/modules/india-post/error-text";
import { runIndiaPostBooking } from "@/modules/india-post/booking-run";
import { markShipmentBookingFailed } from "@/modules/india-post/booking-run";
import { metadataWithFirstBarcodeProof } from "@/modules/india-post/booking-provenance";
import { formatBarcode } from "@/modules/india-post/barcode";
import { bookingFailureShipmentUpdate } from "@/modules/india-post/booking-failure-state";
import { classifyProviderError } from "@/lib/jobs/retry";

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

vi.mock("@/modules/shopify/booking-guard", () => ({
  revalidateShopifyBooking: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/modules/shopify/allocations", () => ({
  markShopifyAllocationsBooked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/india-post/allocate-barcode", () => ({
  allocateNextBarcode: vi.fn(async () => "ET214330016IN"),
}));

const BARCODE = "ET214330016IN";
const BARCODE_2 = formatBarcode("ET", 21433002, "IN");
const ISSUED = "2026-10-31T06:00:00.000Z";

function withProof(barcode: string, id = "ship-1", orderId = "ord-1") {
  return baseShipment({
    id,
    order_id: orderId,
    barcode,
    created_at: ISSUED,
    orders: {
      id: orderId,
      order_number: "#1001",
      source: "EXCEL",
      status: "PROCESSING",
      fulfillment_status: "UNFULFILLED",
    },
    metadata: metadataWithFirstBarcodeProof(null, {
      shipmentId: id,
      organizationId: "org-1",
      barcode,
      issuedAt: ISSUED,
    }),
  });
}

function baseShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship-1",
    organization_id: "org-1",
    order_id: "ord-1",
    status: "QUEUED",
    barcode: null,
    booked_at: null,
    tracking_number: null,
    service_code: "SP_INLAND_PARCEL",
    weight_grams: 500,
    length_cm: 20,
    width_cm: 15,
    height_cm: 10,
    payment_mode: "PREPAID",
    cod_amount: 0,
    orders: {
      id: "ord-1",
      order_number: "#1001",
      source: "SHOPIFY",
      status: "PROCESSING",
      fulfillment_status: "UNFULFILLED",
    },
    customers: { name: "Test", phone: "9876543210" },
    addresses: {
      name: "Test",
      line1: "123 St",
      city: "Delhi",
      state: "Delhi",
      pincode: "110001",
      phone: "9876543210",
      address_validation_status: "READY",
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
      if (filter.op === "filter" && filter.key === "metadata->>ceptSubmitIntentAt") {
        const metadata = row.metadata as Record<string, unknown> | null | undefined;
        const intent = metadata && typeof metadata === "object" ? metadata.ceptSubmitIntentAt : null;
        return (intent == null || intent === "") && filter.value == null;
      }
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
    chain.filter = (key: string, op: string, value: unknown) => {
      filters.push({ op: "filter", key, value: op === "is" ? value : { op, value } });
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
    rpc: async (name: string) => {
      if (name === "acquire_india_post_booking_lock") return { data: "token-test", error: null };
      if (name === "acquire_india_post_session_lock") return { data: "session-lock-token", error: null };
      return { data: null, error: null };
    },
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
      if (table === "addresses") {
        const chain: Record<string, unknown> = {};
        const next = () => chain;
        chain.eq = next;
        chain.is = next;
        chain.select = next;
        chain.update = (patch: Record<string, unknown>) => {
          for (const row of store) {
            const address = row.addresses as Record<string, unknown> | undefined;
            if (address) Object.assign(address, patch);
          }
          return chain;
        };
        chain.maybeSingle = async () => {
          const address = (store[0]?.addresses as Record<string, unknown> | undefined) ?? null;
          return { data: address, error: null };
        };
        chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: store[0]?.addresses ?? null, error: null }).then(resolve, reject);
        return chain;
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

  it("detects unknown in-flight BOOKING and RECOVERY_REQUIRED", () => {
    expect(isIndiaPostBookingUnknown({ status: "BOOKING", barcode: BARCODE, booked_at: null })).toBe(true);
    expect(isIndiaPostBookingUnknown({ status: "RECOVERY_REQUIRED", barcode: BARCODE, booked_at: null })).toBe(true);
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

  it("never treats TEMPORARY_PROVIDER_FAILURE as authorization to POST", () => {
    expect(canRetryCeptPostAfterUnknown({ last_error_code: "TEMPORARY_PROVIDER_FAILURE" })).toBe(false);
  });
});

describe("runIndiaPostBooking idempotency", () => {
  it("does not POST to CEPT when the Shopify order is still PENDING", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([
      baseShipment({ orders: { id: "ord-1", order_number: "#1001", source: "SHOPIFY", payment_status: "PENDING" } }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.failedIds).toEqual(["ship-1"]);
    expect(store[0]?.status).toBe("FAILED");
  });

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
      baseShipment({ status: "BOOKED", booked_at: "2026-10-06T06:00:00.000Z", barcode: BARCODE }),
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
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
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
      baseShipment({ status: "BOOKED", booked_at: "2026-10-06T06:00:00.000Z", barcode: BARCODE }),
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
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN", bookingPhase: "POST_SUBMIT" });
    expect(store[0]?.status).toBe("BOOKING");
    expect(store[0]?.booked_at).toBeNull();
    store[0]!.status = "RECOVERY_REQUIRED";
    store[0]!.last_error_code = "ETIMEDOUT";
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
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
    const blocked = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1"],
    });
    expect(blocked.failedIds).toEqual(["ship-1"]);
    expect(bookShipmentMock).not.toHaveBeenCalled();
    store[0] = baseShipment({ status: "FAILED", booked_at: null });
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  async function firstTemporary409() {
    const conflict = Object.assign(new Error("Internal server error during processing"), { status: 409 });
    bookShipmentMock.mockReset().mockRejectedValueOnce(conflict);
    const { supabase, store } = memoryDb([baseShipment()]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ status: 409 });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    store[0]!.last_error_code = "TEMPORARY_PROVIDER_FAILURE";
    store[0]!.status = "RECOVERY_REQUIRED";
    return { supabase, store };
  }

  it("does not POST again after temporary 409 when tracking is empty", async () => {
    const { supabase, store } = await firstTemporary409();
    trackShipmentMock.mockReset().mockResolvedValue({ data: [] });
    bookShipmentMock.mockResolvedValueOnce(ceptSuccess());
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(store[0]?.last_error_code).toBe("CEPT_UNKNOWN");
    expect(store[0]?.booked_at).toBeNull();
  });

  it("does not POST again after temporary 409 when tracking is unavailable", async () => {
    const { supabase, store } = await firstTemporary409();
    trackShipmentMock.mockReset().mockRejectedValueOnce(new Error("tracking unavailable"));
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
  });

  it("marks BOOKED from tracking after temporary 409 without a second POST", async () => {
    const { supabase, store } = await firstTemporary409();
    trackShipmentMock.mockReset().mockResolvedValue({
      data: [{ booking_details: { article_number: BARCODE } }],
    });
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.status).toBe("BOOKED");
  });

  it("does not POST when tracking says the article was not booked", async () => {
    const { supabase, store } = await firstTemporary409();
    bookShipmentMock.mockResolvedValueOnce(ceptSuccess());
    trackShipmentMock.mockReset().mockResolvedValue({ message: "Article not booked" });
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(store[0]?.status).not.toBe("QUEUED");
  });

  it("does not POST on auto or manual retry after temporary 409 + empty tracking", async () => {
    const { supabase, store } = await firstTemporary409();
    trackShipmentMock.mockReset().mockResolvedValue({ data: [] });
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
  });

  it("does not POST when the DB booking lock RPC is unavailable", async () => {
    bookShipmentMock.mockReset();
    const { supabase } = memoryDb([baseShipment()]);
    delete (supabase as { rpc?: unknown }).rpc;
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });
    expect(bookShipmentMock).not.toHaveBeenCalled();
  });

  it("recovers an unknown booking from tracking without a second CEPT POST", async () => {
    bookShipmentMock.mockReset();
    trackShipmentMock.mockReset().mockResolvedValue({
      data: [{ booking_details: { article_number: BARCODE } }],
    });
    const { supabase, store } = memoryDb([
      baseShipment({ status: "RECOVERY_REQUIRED", booked_at: null, last_error_code: "ETIMEDOUT", barcode: BARCODE }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.status).toBe("BOOKED");
  });

  it("does not POST when tracking says Article not found", async () => {
    bookShipmentMock.mockReset();
    trackShipmentMock.mockReset().mockResolvedValue({ message: "Article not found" });
    const { supabase, store } = memoryDb([
      baseShipment({ status: "RECOVERY_REQUIRED", booked_at: null, last_error_code: "ETIMEDOUT", barcode: BARCODE }),
    ]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
  });

  it("treats duplicate 409 evidence as booked without retrying CEPT", async () => {
    bookShipmentMock.mockReset().mockRejectedValueOnce(
      Object.assign(new Error("Duplicate article: Already booked today or yesterday"), { status: 409 })
    );
    const { supabase, store } = memoryDb([baseShipment()]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.status).toBe("BOOKED");
  });

  it("does not blindly rebook an unrecognized 409", async () => {
    bookShipmentMock.mockReset().mockRejectedValueOnce(
      Object.assign(new Error("Mysterious conflict"), { status: 409 })
    );
    trackShipmentMock.mockReset().mockResolvedValue({ data: [] });
    const { supabase, store } = memoryDb([baseShipment()]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(store[0]?.status).toBe("BOOKING");
    expect(store[0]?.booked_at).toBeNull();
    store[0]!.last_error_code = "CEPT_UNKNOWN";
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
  });

  it("keeps PIN tariff rejection as FAILED without booked_at", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce({
      error_articles: [
        {
          barcode_no: BARCODE,
          errors: ["Please provide proper data for tariff calculation - Destination pincode 673589 not found"],
        },
      ],
    });
    const { supabase, store } = memoryDb([baseShipment()]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("FAILED");
    expect(store[0]?.booked_at).toBeNull();
    expect(store[0]?.tracking_number).toBeNull();
  });

  it("TEST 10 tenant isolation keeps the same barcode on another org bookable", async () => {
    bookShipmentMock.mockReset().mockResolvedValue(ceptSuccess());
    const { supabase } = memoryDb([
      baseShipment({ organization_id: "org-a", status: "BOOKED", booked_at: "2026-10-06T06:00:00.000Z", barcode: BARCODE }),
      baseShipment({ id: "ship-2", organization_id: "org-b", status: "QUEUED" }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-b",
      shipmentIds: ["ship-2"],
    });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-2"]);
  });

  it("classifies a valid legacy NULL address on demand then books", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase, store } = memoryDb([
      baseShipment({
        addresses: {
          id: "addr-1",
          name: "Test",
          line1: "123 St",
          city: "Delhi",
          state: "Delhi",
          pincode: "110001",
          phone: "9876543210",
          address_validation_status: null,
        },
      }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1"],
    });
    expect((store[0]?.addresses as { address_validation_status?: string }).address_validation_status).toBe("READY");
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  it("does not allocate CEPT for a legacy NULL address with an invalid PIN", async () => {
    bookShipmentMock.mockReset();
    const { supabase } = memoryDb([
      baseShipment({
        addresses: {
          id: "addr-1",
          name: "Test",
          line1: "123 St",
          city: "Delhi",
          state: "Delhi",
          pincode: "12",
          phone: "9876543210",
          address_validation_status: null,
        },
      }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1"],
    });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.failedIds).toEqual(["ship-1"]);
  });

  it("does not POST when the linked order is already SHIPPED", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([
      baseShipment({
        created_at: "2026-10-31T12:00:00.000Z",
        orders: {
          id: "ord-1",
          order_number: "#1001",
          source: "SHOPIFY",
          status: "SHIPPED",
          fulfillment_status: "UNFULFILLED",
        },
      }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.booked).toBe(0);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(store[0]?.last_error_code).toBe("BOOKING_REVIEW_REQUIRED");
    expect(store[0]?.barcode).toBeNull();
  });

  it("does not POST a historical first booking that is only PROCESSING", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([
      baseShipment({
        created_at: "2026-10-08T09:12:58.102Z",
        orders: {
          id: "ord-1",
          order_number: "#1001",
          source: "MANUAL",
          status: "PROCESSING",
          fulfillment_status: "UNFULFILLED",
        },
      }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.booked).toBe(0);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(store[0]?.barcode).toBeNull();
  });

  it("does not POST a LABEL_READY shipment that already has booked_at", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([
      baseShipment({
        status: "LABEL_READY",
        booked_at: "2026-10-31T10:23:56.000Z",
        barcode: BARCODE,
      }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.barcode).toBe(BARCODE);
    expect(store[0]?.booked_at).toBe("2026-10-31T10:23:56.000Z");
  });

  it("does not POST a historical barcode that has no submit marker and no error", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([baseShipment({ barcode: BARCODE, last_error_code: null })]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "BOOKING_REVIEW_REQUIRED" });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(store[0]?.barcode).toBe(BARCODE);
  });

  it("posts once for a barcode signed when the shipment was created", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase, store } = memoryDb([withProof(BARCODE)]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.barcode).toBe(BARCODE);
  });

  it("does not POST an Excel-sourced shipment whose barcode has no server proof", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([
      baseShipment({
        barcode: BARCODE,
        metadata: {},
        orders: {
          id: "ord-1",
          order_number: "#1001",
          source: "EXCEL",
          status: "PROCESSING",
          fulfillment_status: "UNFULFILLED",
        },
      }),
    ]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "BOOKING_REVIEW_REQUIRED" });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(store[0]?.last_error_code).toBe("BOOKING_REVIEW_REQUIRED");
    expect(store[0]?.barcode).toBe(BARCODE);
  });

  it("posts once for two newly proved bulk articles", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce({
      batch_id: "batch-1",
      correlation_id: "corr-1",
      valid_articles: [
        { barcode_no: BARCODE, article_number: BARCODE, calculated_tariff: 45 },
        { barcode_no: BARCODE_2, article_number: BARCODE_2, calculated_tariff: 45 },
      ],
      error_articles: [],
    });
    const { supabase } = memoryDb([withProof(BARCODE, "ship-1", "ord-1"), withProof(BARCODE_2, "ship-2", "ord-2")]);
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1", "ship-2"],
    });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    const articles = (bookShipmentMock.mock.calls[0]?.[0] as { articles?: Array<{ barcode_no?: string }> }).articles ?? [];
    expect(articles.map((article) => article.barcode_no).sort()).toEqual([BARCODE, BARCODE_2].sort());
    expect(outcome.bookedIds.sort()).toEqual(["ship-1", "ship-2"]);
  });

  it("keeps a valid bulk article booked when another article is rejected", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce({
      batch_id: "batch-1",
      correlation_id: "corr-1",
      valid_articles: [{ barcode_no: BARCODE, article_number: BARCODE, calculated_tariff: 45 }],
      error_articles: [{ barcode_no: BARCODE_2, message: "Invalid article" }],
    });
    const { supabase } = memoryDb([withProof(BARCODE, "ship-1", "ord-1"), withProof(BARCODE_2, "ship-2", "ord-2")]);
    const outcome = await runIndiaPostBooking(supabase as never, {
      organizationId: "org-1",
      shipmentIds: ["ship-1", "ship-2"],
    });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(outcome.failedIds).toContain("ship-2");
  });

  it("lets two workers post a proved shipment only once", async () => {
    bookShipmentMock.mockReset().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(ceptSuccess()), 30))
    );
    const { supabase } = memoryDb([withProof(BARCODE)]);
    await Promise.allSettled([
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] }),
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] }),
    ]);
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
  });

  it("posts once after a crash that left provenance and no submit intent", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase, store } = memoryDb([withProof(BARCODE)]);
    expect(store[0]?.metadata).toBeTruthy();
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
  });

  it("does not POST again after submit intent is saved", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    trackShipmentMock.mockReset().mockResolvedValue({ data: [] });
    const { supabase, store } = memoryDb([withProof(BARCODE)]);
    await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    store[0]!.status = "BOOKING";
    store[0]!.booked_at = null;
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
  });

  it("marks an HTTP 500 after the booking POST as recovery and does not POST again", async () => {
    const failure = Object.assign(new Error("unavailable"), { status: 500 });
    bookShipmentMock.mockReset().mockRejectedValueOnce(failure);
    trackShipmentMock.mockReset().mockResolvedValue({ message: "Article not found" });
    const { supabase, store } = memoryDb([withProof(BARCODE)]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN", bookingPhase: "POST_SUBMIT" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(
      bookingFailureShipmentUpdate(
        classifyProviderError(
          Object.assign(new Error("unavailable"), { code: "CEPT_UNKNOWN", bookingPhase: "POST_SUBMIT", status: 500 })
        ),
        false
      ).status
    ).toBe("RECOVERY_REQUIRED");
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "CEPT_UNKNOWN" });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(store[0]?.status).toBe("RECOVERY_REQUIRED");
  });

  it("still books a manual shipment that has no barcode yet", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase } = memoryDb([
      baseShipment({
        orders: {
          id: "ord-1",
          order_number: "#1001",
          source: "MANUAL",
          status: "PROCESSING",
          fulfillment_status: "UNFULFILLED",
        },
      }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  it("still books a Shopify shipment that has no barcode yet", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase } = memoryDb([baseShipment()]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  it("does not POST a proved shipment that is already booked", async () => {
    bookShipmentMock.mockReset();
    const row = withProof(BARCODE);
    row.booked_at = ISSUED;
    row.status = "BOOKED";
    const { supabase } = memoryDb([row]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(outcome.bookedIds).toEqual(["ship-1"]);
  });

  it("does not POST when a merchant forges barcode proof metadata", async () => {
    bookShipmentMock.mockReset();
    const { supabase, store } = memoryDb([
      baseShipment({
        barcode: BARCODE,
        created_at: ISSUED,
        metadata: {
          bookingBarcodeProof: { barcode: BARCODE, issuedAt: ISSUED, signature: "merchant-forged" },
        },
      }),
    ]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "BOOKING_REVIEW_REQUIRED" });
    expect(bookShipmentMock).not.toHaveBeenCalled();
    expect(store[0]?.barcode).toBe(BARCODE);
  });

  it("does not POST a shipment that belongs to another organization", async () => {
    bookShipmentMock.mockReset();
    const { supabase } = memoryDb([withProof(BARCODE)]);
    await expect(
      runIndiaPostBooking(supabase as never, { organizationId: "org-2", shipmentIds: ["ship-1"] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(bookShipmentMock).not.toHaveBeenCalled();
  });

  it("reuses a barcode when the stored failure is conclusively pre-POST", async () => {
    bookShipmentMock.mockReset().mockResolvedValueOnce(ceptSuccess());
    const { supabase, store } = memoryDb([
      baseShipment({ barcode: BARCODE, last_error_code: "PRE_POST_TRANSIENT" }),
    ]);
    const outcome = await runIndiaPostBooking(supabase as never, { organizationId: "org-1", shipmentIds: ["ship-1"] });
    expect(bookShipmentMock).toHaveBeenCalledTimes(1);
    expect(outcome.bookedIds).toEqual(["ship-1"]);
    expect(store[0]?.barcode).toBe(BARCODE);
  });
});
