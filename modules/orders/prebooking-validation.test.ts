import { beforeEach, describe, expect, it, vi } from "vitest";

const validateOrdersForBooking = vi.hoisted(() => vi.fn());
vi.mock("@/modules/india-post/bulk-booking", () => ({
  validateOrdersForBooking,
}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError } from "@/lib/api/errors";
import type { IndiaPostOffice } from "@/modules/india-post/endpoints";
import {
  addressValidationFingerprint,
  assessDestinationOffices,
  assessPrebookingAddress,
  clearDestinationPinCache,
  commerceAddressReviewRequired,
  formattingSuggestion,
  gateAddressForBooking,
  isIndiaPostAddressError,
  precheckOrders,
  refreshAddressPrebooking,
} from "@/modules/orders/prebooking-validation";
import type { StoredShippingFields } from "@/modules/shopify/shipping-contact";

vi.mock("@/modules/shopify/address-ai", () => ({
  requestAiAddressSuggestion: vi.fn(),
  applyAiAddressSuggestion: vi.fn(),
}));

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["orders.write"],
};

function address(overrides: Partial<StoredShippingFields> = {}): StoredShippingFields {
  return {
    id: "addr-1",
    name: "Rahul Kumar",
    phone: "9876543210",
    original_phone: "9876543210",
    phone_source: "shipping",
    line1: "House 22, Main Road",
    line2: "",
    line3: "",
    city: "Kalpetta",
    state: "Kerala",
    pincode: "673121",
    country: "IN",
    ...overrides,
  };
}

function office(overrides: Partial<IndiaPostOffice> = {}): IndiaPostOffice {
  return {
    office_id: "10000001",
    office_name: "Kalpetta SO",
    city_name: "Kalpetta",
    state_name: "Kerala",
    delivery_office_flag: true,
    ...overrides,
  };
}

function search(offices: IndiaPostOffice[] | Error) {
  return vi.fn(async () => {
    if (offices instanceof Error) throw offices;
    return offices;
  });
}

describe("pre-booking address checks", () => {
  beforeEach(() => {
    validateOrdersForBooking.mockReset();
  });

  it("accepts a complete address when the PIN office matches", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(address(), { searchPostOffices: search([office()]), allowAi: true });
    expect(result.status).toBe("READY");
    expect(result.issues.filter((issue) => issue.blocking)).toEqual([]);
  });

  it("blocks a missing customer name", async () => {
    const result = await assessPrebookingAddress(address({ name: "" }), { searchPostOffices: search([office()]) });
    expect(result.status).toBe("INVALID");
    expect(result.issues.some((issue) => issue.code === "missing_name")).toBe(true);
  });

  it("blocks an invalid mobile number", async () => {
    const result = await assessPrebookingAddress(address({ phone: "12345" }));
    expect(result.status).toBe("INVALID");
    expect(result.issues.some((issue) => issue.code === "invalid_phone")).toBe(true);
  });

  it("blocks a PIN that is not six digits", async () => {
    const lookup = search([office()]);
    const result = await assessPrebookingAddress(address({ pincode: "67312" }), { searchPostOffices: lookup });
    expect(result.status).toBe("INVALID");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks a PIN and state mismatch", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(address({ state: "Tamil Nadu" }), {
      searchPostOffices: search([office({ state_name: "Kerala" })]),
    });
    expect(result.status).toBe("INVALID");
    expect(result.issues.some((issue) => issue.code === "pin_state_mismatch")).toBe(true);
  });

  it("suggests a cleanup for duplicate words without dropping the house number", () => {
    const suggestion = formattingSuggestion(address({ line1: "House 22, , Main Road, Main Road, Kalpetta, , Wayanad" }));
    expect(suggestion?.line1).toContain("House 22");
    expect(suggestion?.line1).toContain("Main Road");
    expect(suggestion?.line1?.match(/Main Road/g)).toHaveLength(1);
    expect(suggestion?.line1).not.toMatch(/,\s*,/);
  });

  it("flags a very long address for review", async () => {
    const result = await assessPrebookingAddress(address({ line1: "X".repeat(250) }));
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.issues.some((issue) => issue.code === "address_too_long")).toBe(true);
  });

  it("keeps Malayalam characters in a formatting suggestion", () => {
    const suggestion = formattingSuggestion(address({ line1: "വീട് 22, വീട് 22, മെയിൻ റോഡ്" }));
    expect(suggestion?.line1).toContain("വീട് 22");
    expect(suggestion?.line1).toContain("മെയിൻ റോഡ്");
  });

  it("asks for house details when line 1 is only the city", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(address({ line1: "Kalpetta" }), {
      searchPostOffices: search([office()]),
    });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.issues.some((issue) => issue.code === "missing_house")).toBe(true);
  });

  it("keeps the deterministic result when AI times out", async () => {
    clearDestinationPinCache();
    const { requestAiAddressSuggestion } = await import("@/modules/shopify/address-ai");
    vi.mocked(requestAiAddressSuggestion).mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const messy = address({
      line1: "Near, Temple, Market, School, Hospital, Bank, Bus, Stand",
    });
    const result = await assessPrebookingAddress(messy, { searchPostOffices: search([office()]), allowAi: true });
    expect(result.status === "READY" || result.status === "NEEDS_REVIEW").toBe(true);
    expect(result.issues.some((issue) => issue.code === "ai_formatting")).toBe(false);
  });

  it("marks the PIN check unavailable when India Post fails", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(address(), {
      searchPostOffices: search(new Error("timeout")),
    });
    expect(result.status).toBe("VALIDATION_UNAVAILABLE");
  });

  it("does not treat several offices as the first office", () => {
    const result = assessDestinationOffices("Kerala", "Sultan Bathery", [
      office({ office_name: "Kalpetta SO", city_name: "Kalpetta" }),
      office({ office_id: "10000002", office_name: "Sultan Bathery SO", city_name: "Sultan Bathery" }),
    ]);
    expect(result.status).toBe("VERIFIED");
    expect(result.offices.map((item) => item.name)).toEqual(["Sultan Bathery SO"]);
  });

  it("reuses a stored result until the address changes", async () => {
    clearDestinationPinCache();
    const lookup = search([office()]);
    const updates: unknown[] = [];
    const supabase = {
      from() {
        return {
          update(values: unknown) {
            updates.push(values);
            return this;
          },
          eq() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
      },
    } as unknown as SupabaseClient;
    const first = await refreshAddressPrebooking(supabase, {
      organizationId: "org-1",
      address: address(),
      searchPostOffices: lookup,
    });
    const second = await refreshAddressPrebooking(supabase, {
      organizationId: "org-1",
      address: first,
      searchPostOffices: lookup,
    });
    expect(second.address_validation_status).toBe("READY");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(addressValidationFingerprint(address({ line1: "House 23" }))).not.toBe(first.address_validation_fingerprint);
  });

  it("still gates booking when saving the check result fails", async () => {
    clearDestinationPinCache();
    const supabase = {
      from() {
        return {
          update() {
            return this;
          },
          eq() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({
              data: null,
              error: { code: "PGRST204", message: "Could not find the 'address_validation_fingerprint' column of 'addresses' in the schema cache" },
            }).then(resolve);
          },
        };
      },
    } as unknown as SupabaseClient;
    const gate = await gateAddressForBooking(supabase, {
      organizationId: "org-1",
      address: address(),
      searchPostOffices: search([office()]),
    });
    expect(gate.ok).toBe(true);
  });

  it("fails closed for a wrong organization", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    await expect(precheckOrders(supabase, ctx, ["order-1"])).rejects.toBeInstanceOf(AppError);
  });

  it("does not book an already booked shipment and reports mixed rows", async () => {
    const rows = [
      {
        id: "ready-1",
        order_number: "100",
        source: "SHOPIFY",
        customers: { name: "Asha" },
        shipments: [{ status: "QUEUED", weight_grams: 500, length_cm: 20, width_cm: 15, height_cm: 10 }],
        shipping_address: {
          ...address(),
          address_validation_status: "READY",
          address_validation_fingerprint: addressValidationFingerprint(address()),
          address_validation_errors: [],
        },
      },
      {
        id: "booked-1",
        order_number: "101",
        source: "MANUAL",
        customers: { name: "Rahul" },
        shipments: [{ status: "BOOKED" }],
        shipping_address: address(),
      },
    ];
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return Promise.resolve({ data: rows, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    validateOrdersForBooking.mockResolvedValue({
      rows: [
        { orderId: "ready-1", valid: true, issues: [] },
        { orderId: "booked-1", valid: false, issues: [] },
      ],
      issues: [{ orderId: "booked-1", field: "order", error: "This order is already booked." }],
    });
    const result = await precheckOrders(supabase, ctx, ["ready-1", "booked-1"], { allowAi: false });
    expect(result.orders.find((order) => order.orderId === "ready-1")?.status).toBe("ready");
    expect(result.orders.find((order) => order.orderId === "booked-1")?.status).toBe("fix_required");
    expect(result.orders.find((order) => order.orderId === "ready-1")?.source).toBe("SHOPIFY");
  });

  it("blocks booking when PIN verification is down and does not require a barcode", async () => {
    clearDestinationPinCache();
    const supabase = {
      from() {
        return {
          update() {
            return this;
          },
          eq() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
      },
    } as unknown as SupabaseClient;
    const gate = await gateAddressForBooking(supabase, {
      organizationId: "org-1",
      address: address(),
      searchPostOffices: search(new Error("down")),
      allowAi: false,
    });
    expect(gate.ok).toBe(false);
    expect(gate.retryable).toBe(true);
  });

  it("recognizes an India Post address rejection without treating a weight error as one", () => {
    expect(isIndiaPostAddressError("Destination pincode 000000 not found")).toBe(true);
    expect(isIndiaPostAddressError("Weight must be at least 1 gram.")).toBe(false);
  });

  it("reviews Shopify and WooCommerce addresses and lets other sources book", () => {
    expect(commerceAddressReviewRequired("SHOPIFY")).toBe(true);
    expect(commerceAddressReviewRequired("woocommerce")).toBe(true);
    expect(commerceAddressReviewRequired("MANUAL")).toBe(false);
    expect(commerceAddressReviewRequired("API")).toBe(false);
    expect(commerceAddressReviewRequired("WHATSAPP")).toBe(false);
    expect(commerceAddressReviewRequired("EXCEL")).toBe(false);
  });

  it("lets a manual order book when house details look missing", async () => {
    const searchPostOffices = vi.fn(async () => {
      throw new Error("address review should not run");
    });
    const gate = await gateAddressForBooking({} as SupabaseClient, {
      organizationId: "org-1",
      address: address({ line1: "Kalpetta" }),
      searchPostOffices,
      orderSource: "MANUAL",
    });
    expect(gate.ok).toBe(true);
    expect(gate.message).toBeNull();
    expect(searchPostOffices).not.toHaveBeenCalled();
  });

  it("still blocks a Shopify order when house details are missing from line 1", async () => {
    clearDestinationPinCache();
    const supabase = {
      from() {
        return {
          update() {
            return this;
          },
          eq() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
      },
    } as unknown as SupabaseClient;
    const gate = await gateAddressForBooking(supabase, {
      organizationId: "org-1",
      address: address({ line1: "Kalpetta" }),
      searchPostOffices: search([office()]),
      allowAi: false,
      orderSource: "SHOPIFY",
    });
    expect(gate.ok).toBe(false);
    expect(gate.message).toMatch(/House or building details look missing from address line 1/);
  });

  it("treats a stored address review as ready for manual orders and keeps it for Shopify", async () => {
    const reviewed = {
      ...address({ line1: "Kalpetta" }),
      address_validation_status: "NEEDS_REVIEW",
      address_validation_errors: [
        {
          code: "missing_house",
          field: "line1",
          message: "House or building details look missing from address line 1.",
          blocking: false,
        },
      ],
    };
    const rows = [
      {
        id: "manual-1",
        order_number: "200",
        source: "MANUAL",
        customers: { name: "Manual" },
        shipments: [{ status: "QUEUED", weight_grams: 500, length_cm: 20, width_cm: 15, height_cm: 10 }],
        shipping_address: reviewed,
      },
      {
        id: "shop-1",
        order_number: "201",
        source: "SHOPIFY",
        customers: { name: "Store" },
        shipments: [{ status: "QUEUED", weight_grams: 500, length_cm: 20, width_cm: 15, height_cm: 10 }],
        shipping_address: reviewed,
      },
    ];
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return Promise.resolve({ data: rows, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    validateOrdersForBooking.mockResolvedValue({
      rows: [
        { orderId: "manual-1", valid: true, issues: [] },
        { orderId: "shop-1", valid: true, issues: [] },
      ],
      issues: [],
    });
    const result = await precheckOrders(supabase, ctx, ["manual-1", "shop-1"], { allowAi: false });
    const manual = result.orders.find((order) => order.orderId === "manual-1");
    const shop = result.orders.find((order) => order.orderId === "shop-1");
    expect(manual?.status).toBe("ready");
    expect(manual?.issues.some((issue) => issue.code === "missing_house")).toBe(false);
    expect(shop?.status).toBe("needs_review");
    expect(shop?.issues.some((issue) => issue.code === "missing_house")).toBe(true);
  });
});
