import { beforeEach, describe, expect, it, vi } from "vitest";

const searchPostOffices = vi.hoisted(() => vi.fn());
const createBackgroundJob = vi.hoisted(() => vi.fn(async () => ({ id: "job-1" })));
const enqueueShipmentBookingJob = vi.hoisted(() => vi.fn(async () => ({ id: "book-1" })));
const openRouterEnabled = vi.hoisted(() => vi.fn(async () => ({ enabled: false, apiKey: "", model: "" })));
const requestAiAddressSuggestion = vi.hoisted(() => vi.fn());

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: () => ({ searchPostOffices }),
}));
vi.mock("@/modules/jobs/service", () => ({ createBackgroundJob }));
vi.mock("@/modules/jobs/shipment-booking-job", () => ({ enqueueShipmentBookingJob }));
vi.mock("@/modules/openrouter/platform-config", () => ({
  getPlatformOpenRouterConfig: openRouterEnabled,
}));
vi.mock("@/modules/shopify/address-ai", () => ({ requestAiAddressSuggestion }));

import {
  correctShopifyShippingAddress,
  enqueueShopifyAddressCorrection,
  runShopifyAddressCorrectionJob,
  shopifyAddressUpdateIsStale,
  shopifyBookingWaitsForAddressCorrection,
  shouldRequeueCorrectedShopifyShipment,
} from "@/modules/shopify/address-corrector";
import { clearDestinationPinCache } from "@/modules/orders/prebooking-validation";

const deliveryOffice = {
  office_id: "56000101",
  office_name: "Bengaluru GPO",
  city_name: "Bengaluru",
  state_name: "Karnataka",
  delivery_office_flag: true,
  office_type_code: "HO",
  pincode: "560001",
};

function address(overrides: Record<string, unknown> = {}) {
  return {
    id: "addr-1",
    name: "Asha Rao",
    phone: "9876543210",
    original_phone: "9876543210",
    phone_source: "shipping",
    line1: "House 22, Main Road",
    line2: "",
    line3: "",
    city: "Mysuru",
    state: "Karnataka",
    pincode: "560001",
    country: "IN",
    address_manual_override: false,
    normalized_shipping: { sourceUpdatedAt: "2026-11-02T10:00:00Z" },
    original_shipping: { address1: "House 22, Main Road", city: "Mysuru", zip: "560001" },
    ...overrides,
  };
}

function supabaseFor(options: {
  address?: Record<string, unknown> | null;
  shipments?: Array<Record<string, unknown>>;
  connection?: Record<string, unknown> | null;
  activeJob?: { id: string } | null;
  aiAddressCheck?: boolean;
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const addressRow = options.address === undefined ? address() : options.address;
  const shipments = options.shipments ?? [];
  const connection = options.connection === undefined ? { id: "conn-1", status: "CONNECTED" } : options.connection;
  const client = {
    from(table: string) {
      const api: Record<string, unknown> = {};
      const chain = () => api;
      api.select = chain;
      api.eq = chain;
      api.in = chain;
      api.is = chain;
      api.order = chain;
      api.limit = chain;
      api.update = (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return api;
      };
      api.insert = chain;
      api.maybeSingle = async () => {
        if (table === "addresses") return { data: addressRow, error: null };
        if (table === "india_post_connections") return { data: connection, error: null };
        if (table === "background_jobs") return { data: options.activeJob ?? null, error: null };
        if (table === "automation_settings") {
          return {
            data: options.aiAddressCheck === undefined ? null : { auto_ai_address_check: options.aiAddressCheck },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      api.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: table === "shipments" ? shipments : null, error: null }).then(resolve);
      return api;
    },
  };
  return { client, updates };
}

describe("shopify address corrector", () => {
  beforeEach(() => {
    clearDestinationPinCache();
    searchPostOffices.mockReset();
    searchPostOffices.mockResolvedValue([deliveryOffice]);
    createBackgroundJob.mockClear();
    enqueueShipmentBookingJob.mockClear();
    openRouterEnabled.mockReset();
    openRouterEnabled.mockResolvedValue({ enabled: false, apiKey: "", model: "" });
    requestAiAddressSuggestion.mockReset();
  });

  it("sets the city from the delivery office when the typed city does not match", async () => {
    const { client, updates } = supabaseFor({});
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
    });
    expect(result.outcome).toBe("updated");
    expect(result.deferBooking).toBe(false);
    expect(updates.find((row) => row.table === "addresses")?.payload.city).toBe("Bengaluru");
    expect(requestAiAddressSuggestion).not.toHaveBeenCalled();
  });

  it("leaves a city that already matches the delivery office", async () => {
    const { client, updates } = supabaseFor({ address: address({ city: "Bengaluru" }) });
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
    });
    expect(result.changed).toBe(false);
    expect(updates.find((row) => row.table === "addresses")?.payload.city).toBeUndefined();
  });

  it("defers booking when the street still needs AI and does not call the model inline", async () => {
    openRouterEnabled.mockResolvedValue({ enabled: true, apiKey: "k", model: "m" });
    const messy = address({
      line1: "House 12, Temple Road, Near Market, Opposite School, Behind Bank, Cross 4, Stage 2, Layout West",
    });
    const { client } = supabaseFor({ address: messy, aiAddressCheck: true });
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      bookingIntent: { enqueueBooking: true, enrollInQueue: false },
    });
    expect(result.deferBooking).toBe(true);
    expect(shopifyBookingWaitsForAddressCorrection(result.deferBooking)).toBe(true);
    expect(requestAiAddressSuggestion).not.toHaveBeenCalled();
    expect(enqueueShipmentBookingJob).not.toHaveBeenCalled();
  });

  it("skips AI when the workspace address check is off", async () => {
    openRouterEnabled.mockResolvedValue({ enabled: true, apiKey: "k", model: "m" });
    const messy = address({
      line1: "House 12, Temple Road, Near Market, Opposite School, Behind Bank, Cross 4, Stage 2, Layout West",
    });
    const { client } = supabaseFor({ address: messy, aiAddressCheck: false });
    const deferred = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      bookingIntent: { enqueueBooking: true, enrollInQueue: false },
    });
    const forced = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      phase: "ai",
    });
    expect(deferred.deferBooking).toBe(false);
    expect(forced.outcome).not.toBe("failed");
    expect(requestAiAddressSuggestion).not.toHaveBeenCalled();
  });

  it("keeps the deterministic address when AI times out", async () => {
    requestAiAddressSuggestion.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const messy = address({
      line1: "House 12, Temple Road, Near Market, Opposite School, Behind Bank, Cross 4, Stage 2, Layout West",
    });
    const { client, updates } = supabaseFor({ address: messy, aiAddressCheck: true });
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      phase: "ai",
    });
    expect(result.outcome).not.toBe("failed");
    expect(updates.find((row) => row.table === "addresses")?.payload.city).toBe("Bengaluru");
    expect(requestAiAddressSuggestion).toHaveBeenCalled();
  });

  it("still imports when the PIN lookup fails", async () => {
    searchPostOffices.mockRejectedValue(new Error("timeout"));
    const { client } = supabaseFor({});
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
    });
    expect(result.outcome).not.toBe("failed");
    expect(result.changed).toBe(false);
  });

  it("does not change a hand-edited address", async () => {
    const { client, updates } = supabaseFor({ address: address({ address_manual_override: true }) });
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
    });
    expect(result.skipReason).toBe("manual_override");
    expect(updates).toEqual([]);
  });

  it("does not change an address on a booked shipment", async () => {
    const { client, updates } = supabaseFor({
      shipments: [{ id: "shp-1", status: "BOOKED", booked_at: "2026-11-01T00:00:00Z" }],
    });
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
    });
    expect(result.skipReason).toBe("booked");
    expect(updates.filter((row) => row.table === "addresses")).toEqual([]);
  });

  it("ignores a manual-source order", async () => {
    const { client, updates } = supabaseFor({});
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      source: "MANUAL",
    });
    expect(result.skipReason).toBe("source");
    expect(updates).toEqual([]);
  });

  it("requeues a failed address shipment when auto-booking is on and the city changed", async () => {
    const { client } = supabaseFor({
      shipments: [
        {
          id: "shp-1",
          status: "FAILED",
          last_error_code: "VALIDATION_ERROR",
          last_error: "The city does not match the post offices for the provided PIN code.",
        },
      ],
    });
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      allowRequeue: true,
      bookingIntent: { enqueueBooking: true, enrollInQueue: false },
    });
    expect(result.requeued).toBe(true);
    expect(enqueueShipmentBookingJob).toHaveBeenCalledTimes(1);
  });

  it("does not requeue a payment failure", () => {
    expect(
      shouldRequeueCorrectedShopifyShipment({
        changed: true,
        autoBooking: true,
        shipment: { id: "shp-1", status: "FAILED", last_error_code: "PAYMENT_FAILED", last_error: "Payment is unpaid." },
      })
    ).toBe(false);
  });

  it("does not requeue an unknown India Post outcome", () => {
    expect(
      shouldRequeueCorrectedShopifyShipment({
        changed: true,
        autoBooking: true,
        shipment: { id: "shp-1", status: "FAILED", last_error_code: "CEPT_UNKNOWN", last_error: "Outcome is unknown." },
      })
    ).toBe(false);
  });

  it("does not requeue when auto-booking is off or the address did not change", async () => {
    const { client } = supabaseFor({
      address: address({ city: "Bengaluru" }),
      shipments: [
        {
          id: "shp-1",
          status: "FAILED",
          last_error_code: "VALIDATION_ERROR",
          last_error: "The city does not match the post offices for the provided PIN code.",
        },
      ],
    });
    const unchanged = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      allowRequeue: true,
      bookingIntent: { enqueueBooking: true, enrollInQueue: false },
    });
    const disabled = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T10:00:00Z",
      allowRequeue: true,
      bookingIntent: { enqueueBooking: false, enrollInQueue: false },
    });
    expect(unchanged.requeued).toBe(false);
    expect(disabled.requeued).toBe(false);
    expect(enqueueShipmentBookingJob).not.toHaveBeenCalled();
  });

  it("returns the active correction job instead of inserting another", async () => {
    const first = supabaseFor({});
    const queued = await enqueueShopifyAddressCorrection(first.client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      fingerprint: "abc",
      bookingIntent: { enqueueBooking: true, enrollInQueue: false },
      allowRequeue: false,
    });
    const second = supabaseFor({ activeJob: { id: "job-1" } });
    const duplicate = await enqueueShopifyAddressCorrection(second.client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      fingerprint: "abc",
      bookingIntent: { enqueueBooking: true, enrollInQueue: false },
      allowRequeue: false,
    });
    expect(queued.duplicate).toBe(false);
    expect(duplicate).toEqual({ jobId: "job-1", duplicate: true });
    expect(createBackgroundJob).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a newer Shopify address", async () => {
    const { client, updates } = supabaseFor({});
    const result = await correctShopifyShippingAddress(client as never, {
      organizationId: "org-1",
      orderId: "ord-1",
      addressId: "addr-1",
      sourceUpdatedAt: "2026-11-02T09:00:00Z",
    });
    expect(shopifyAddressUpdateIsStale("2026-11-02T10:00:00Z", "2026-11-02T09:00:00Z")).toBe(true);
    expect(result.skipReason).toBe("stale");
    expect(updates).toEqual([]);
  });

  it("enqueues the first booking only after the AI job runs", async () => {
    requestAiAddressSuggestion.mockResolvedValue(null);
    const { client } = supabaseFor({ shipments: [{ id: "shp-1", status: "DRAFT" }], aiAddressCheck: true });
    await runShopifyAddressCorrectionJob(client as never, {
      organizationId: "org-1",
      addressId: "addr-1",
      progress: { orderId: "ord-1", enqueueBooking: true, enrollInQueue: false },
    });
    expect(enqueueShipmentBookingJob).toHaveBeenCalledTimes(1);
  });
});
