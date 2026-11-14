import { beforeEach, describe, expect, it, vi } from "vitest";

const validateOrdersForBooking = vi.hoisted(() => vi.fn());
vi.mock("@/modules/india-post/bulk-booking", () => ({
  validateOrdersForBooking,
}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
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
  packAddressForIndiaPostBooking,
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
  beforeEach(async () => {
    validateOrdersForBooking.mockReset();
    const { requestAiAddressSuggestion } = await import("@/modules/shopify/address-ai");
    vi.mocked(requestAiAddressSuggestion).mockReset();
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

  it("packs floor and unit details onto line 1 for booking", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(
      address({
        line1: "Plot No-13/14P, Vaishnavi West Block, Mithila Nagar",
        line2: "Pragathi Nagar, First Floor,G3",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500090",
      }),
      { searchPostOffices: search([office({ city_name: "Hyderabad", state_name: "Telangana" })]) }
    );
    expect(result.status).toBe("READY");
    expect(result.autoCorrected).toBe(true);
    expect(result.address.line1).toMatch(/Plot No-13\/14P/i);
    expect(result.address.line1).toMatch(/First Floor/i);
    expect(result.address.line1).toMatch(/G3/i);
    expect(result.address.line2).toMatch(/Mithila Nagar/i);
    expect(result.address.line2).toMatch(/Pragathi Nagar/i);
    expect(result.address.pincode).toBe("500090");
  });

  it("lengthens a 2-character address line before booking", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(
      address({ line1: "12", line2: "Green Park Road" }),
      { searchPostOffices: search([office()]) }
    );
    expect(result.status).toBe("READY");
    expect(result.autoCorrected).toBe(true);
    expect(result.address.line1.length).toBeGreaterThanOrEqual(3);
    expect(result.address.line1).toMatch(/^12\b/);
    expect(`${result.address.line1} ${result.address.line2}`).toContain("Green Park Road");
  });

  it("does not pack a simple house-and-street address", () => {
    expect(packAddressForIndiaPostBooking(address())).toBeNull();
  });

  it("auto-applies a safe AI street reorder", async () => {
    clearDestinationPinCache();
    const { requestAiAddressSuggestion } = await import("@/modules/shopify/address-ai");
    vi.mocked(requestAiAddressSuggestion).mockResolvedValue({
      address_line_1: "House 22, Alpha, Beta",
      address_line_2: "Gamma, Delta, Epsilon",
      address_line_3: "Zeta, Eta",
      city: "Kalpetta",
      state: "Kerala",
      pincode: "673121",
      changes: ["Packed street lines"],
      warnings: [],
      needs_review: false,
    });
    const result = await assessPrebookingAddress(
      address({ line1: "House 22, Alpha, Beta, Gamma, Delta, Epsilon, Zeta, Eta" }),
      { searchPostOffices: search([office()]), allowAi: true }
    );
    expect(result.status).toBe("READY");
    expect(result.autoCorrected).toBe(true);
    expect(result.address.line1).toBe("House 22, Alpha, Beta");
    expect(result.address.line2).toBe("Gamma, Delta, Epsilon");
    expect(result.issues.some((issue) => issue.code === "ai_formatting")).toBe(false);
  });

  it("books a repeated locality after removing the duplicate", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(
      address({ line1: "House 22, Main Road, Main Road, Kalpetta" }),
      { searchPostOffices: search([office()]) }
    );
    expect(result.status).toBe("READY");
    expect(result.autoCorrected).toBe(true);
    expect(result.address.line1.match(/Main Road/g)).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === "address_formatting")).toBe(false);
  });

  it("lets a stored formatting note through once the live address is ready", async () => {
    clearDestinationPinCache();
    const stored = address({
      address_validation_status: "NEEDS_REVIEW",
      address_validation_errors: [
        { code: "address_formatting", message: "Repeated locality or address line removed.", blocking: false },
      ],
    });
    stored.address_validation_fingerprint = addressValidationFingerprint(stored);
    const gate = await gateAddressForBooking(
      {
        from() {
          return {
            update() {
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
      } as unknown as SupabaseClient,
      { organizationId: "org-1", address: stored, searchPostOffices: search([office()]) }
    );
    expect(gate.ok).toBe(true);
    expect(gate.message).toBeNull();
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

  it("accepts a PIN that has post offices even when the city name differs", () => {
    const result = assessDestinationOffices("Tamil Nadu", "Chengalpattu", [
      office({ office_name: "Kattankolathur SO", city_name: "Kattankolathur", state_name: "Tamil Nadu" }),
      office({ office_id: "10000002", office_name: "Kavanur BO", city_name: "Kavanur", state_name: "Tamil Nadu" }),
      office({ office_id: "10000003", office_name: "Ninnakarai BO", city_name: "Ninnakarai", state_name: "Tamil Nadu" }),
    ]);
    expect(result.status).toBe("VERIFIED");
    expect(result.message).toBe("");
    expect(result.offices.map((item) => item.name)).toEqual(["Kattankolathur SO", "Kavanur BO", "Ninnakarai BO"]);
  });

  it("sets the city from the PIN delivery office when the typed city does not match", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(
      address({ city: "Chengalpattu", state: "Tamil Nadu", pincode: "603203" }),
      {
        searchPostOffices: search([
          office({
            office_name: "Kattankolathur SO",
            city_name: "Kattankolathur",
            state_name: "Tamil Nadu",
            delivery_office_flag: true,
          }),
          office({
            office_id: "10000002",
            office_name: "Kavanur BO",
            city_name: "Kavanur",
            state_name: "Tamil Nadu",
            delivery_office_flag: false,
          }),
        ]),
      }
    );
    expect(result.status).toBe("READY");
    expect(result.address.city).toBe("Kattankolathur");
    expect(result.autoCorrected).toBe(true);
  });

  it("leaves the city unchanged when eligible delivery offices disagree", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(
      address({ city: "Chengalpattu", state: "Tamil Nadu", pincode: "603203" }),
      {
        searchPostOffices: search([
          office({
            office_name: "Kattankolathur SO",
            city_name: "Kattankolathur",
            state_name: "Tamil Nadu",
            delivery_office_flag: true,
          }),
          office({
            office_id: "10000002",
            office_name: "Kavanur BO",
            city_name: "Kavanur",
            state_name: "Tamil Nadu",
            delivery_office_flag: true,
          }),
        ]),
      }
    );
    expect(result.address.city).toBe("Chengalpattu");
  });

  it("does not replace the city with an office name", async () => {
    clearDestinationPinCache();
    const result = await assessPrebookingAddress(
      address({ city: "Chengalpattu", state: "Tamil Nadu", pincode: "603203" }),
      {
        searchPostOffices: search([
          office({
            office_name: "Kattankolathur SO",
            city_name: "",
            state_name: "Tamil Nadu",
            delivery_office_flag: true,
          }),
        ]),
      }
    );
    expect(result.address.city).toBe("Chengalpattu");
  });

  it("says when a PIN has no post office", () => {
    const result = assessDestinationOffices("Tamil Nadu", "Chengalpattu", []);
    expect(result.status).toBe("INVALID");
    expect(result.message).toMatch(/PIN code was not found/i);
  });

  it("rewrites a cached READY address when premises sit on line 2", async () => {
    clearDestinationPinCache();
    const lookup = search([office({ city_name: "Hyderabad", state_name: "Telangana" })]);
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
    const messy = address({
      line1: "Plot No-13/14P, Vaishnavi West Block, Mithila Nagar",
      line2: "Pragathi Nagar, First Floor,G3",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500090",
    });
    const next = await refreshAddressPrebooking(supabase, {
      organizationId: "org-1",
      address: {
        ...messy,
        address_validation_status: "READY",
        address_validation_fingerprint: addressValidationFingerprint(messy),
      },
      searchPostOffices: lookup,
    });
    expect(next.line1).toMatch(/G3/i);
    expect(lookup).toHaveBeenCalled();
    expect(updates[0]).toEqual(expect.objectContaining({ line1: expect.stringMatching(/First Floor/i) }));
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

  it("does not call AI on precheck when the workspace flag is off", async () => {
    const { requestAiAddressSuggestion } = await import("@/modules/shopify/address-ai");
    validateOrdersForBooking.mockRejectedValue(
      new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, "India Post is not connected.")
    );
    const shipping = address({
      line1: "House 12, Temple Road, Near Market, Opposite School, Behind Bank, Cross 4, Stage 2, Layout West",
    });
    const rows = [
      {
        id: "shop-ai",
        order_number: "200",
        source: "SHOPIFY",
        customers: { name: "Asha" },
        shipments: [],
        shipping_address: shipping,
      },
    ];
    const supabase = {
      from(table: string) {
        if (table === "automation_settings") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({ data: { auto_ai_address_check: false }, error: null }),
          };
        }
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          update() {
            return this;
          },
          in() {
            return Promise.resolve({ data: rows, error: null });
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
      },
    } as unknown as SupabaseClient;
    await precheckOrders(supabase, ctx, ["shop-ai"], { allowAi: true, forceAi: true });
    expect(requestAiAddressSuggestion).not.toHaveBeenCalled();
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
