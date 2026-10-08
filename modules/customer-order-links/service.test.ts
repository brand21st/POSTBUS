import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { hashSecret } from "@/lib/security/crypto";
import {
  getPublicCustomerOrderLink,
  lookupPublicOrderLinkPincode,
  submitPublicCustomerOrderLink,
} from "@/modules/customer-order-links/public";
import {
  confirmCustomerOrderLinkSchema,
  customerOrderLinkPath,
  parseCustomerOrderLinkParts,
  submitCustomerOrderLinkSchema,
} from "@/modules/customer-order-links/schema";
import { hashedCustomerOrderPublicId } from "@/modules/customer-order-links/public-id";
import {
  confirmLegacyCustomerOrderLink,
  getMerchantCollectionLink,
} from "@/modules/customer-order-links/service";
import { confirmWhatsAppOrder, createManualOrder } from "@/modules/orders/service";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { loadCatalogProducts } from "@/modules/products/service";

vi.mock("@/modules/storefront/order-notify", () => ({
  notifyStorefrontOrderCreated: vi.fn(async () => {}),
}));

vi.mock("@/modules/orders/service", () => ({
  createManualOrder: vi.fn(async () => ({ id: "order-1", order_number: "WA-PB-10001", totalAmount: 1499 })),
  confirmWhatsAppOrder: vi.fn(async () => ({ id: "order-1", status: "READY" })),
}));

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(),
}));

vi.mock("@/modules/products/service", () => ({
  loadCatalogProducts: vi.fn(async () => []),
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

const TOKEN = "a".repeat(64);
const HASH = hashSecret(TOKEN);
const TOKEN_REF = { kind: "token" as const, token: TOKEN };
const PATH_REF = { kind: "path" as const, workspace: "merchant-a" };

type Row = Record<string, unknown>;

function thenable(result: { data: unknown; error: unknown; count?: number | null }) {
  const query: Record<string, unknown> = {
    insert: () => query,
    update: () => query,
    select: () => query,
    eq: () => query,
    in: () => query,
    gt: () => query,
    order: () => query,
    range: () => query,
    limit: () => query,
    single: () => Promise.resolve({ data: result.data, error: result.error }),
    maybeSingle: () => Promise.resolve({ data: result.data, error: result.error }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: result.data, error: result.error, count: result.count ?? null }).then(resolve, reject),
  };
  return query;
}

const activeLink = {
  id: "link-1",
  organization_id: "org-1",
  status: "ACTIVE",
  expires_at: null,
  public_workspace: "merchant-a",
  public_code: "4821",
};

describe("customer order link schemas", () => {
  it("builds a permanent merchant path", () => {
    expect(customerOrderLinkPath("zoura-parfums", "1234")).toBe(
      "/order/1234/zoura-parfums/WhatsApp-order-form"
    );
    expect(parseCustomerOrderLinkParts(["merchant-a"])).toEqual({ workspace: "merchant-a" });
    expect(parseCustomerOrderLinkParts(["1234", "zoura-parfums", "WhatsApp-order-form"])).toEqual({
      workspace: "zoura-parfums",
      publicId: "1234",
    });
    expect(parseCustomerOrderLinkParts(["Priya-Stores", "0081", "whatsapp-order-form"])).toEqual({
      workspace: "priya-stores",
      publicId: "0081",
    });
  });

  it("normalizes a valid customer submit payload", () => {
    const parsed = submitCustomerOrderLinkSchema.parse({
      customerName: "Rahul",
      phone: "+91 9876543210",
      line1: "12 ABC House",
      city: "Kozhikode",
      state: "Kerala",
      pincode: "673001",
    });
    expect(parsed.customerName).toBe("Rahul");
    expect(parsed.pincode).toBe("673001");
  });
});

describe("getMerchantCollectionLink", () => {
  it("returns the existing ACTIVE merchant URL without creating another", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        throw new Error(table);
      },
    };
    const result = await getMerchantCollectionLink(client as never, ctx);
    expect(result).toMatchObject({
      id: "link-1",
      slug: "merchant-a",
      publicId: "4821",
      status: "ACTIVE",
    });
    expect(result.url).toMatch(/\/order\/4821\/merchant-a\/WhatsApp-order-form$/);
  });

  it("creates one ACTIVE link when the merchant has none", async () => {
    let inserted: Row | null = null;
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({ data: null, error: null });
          q.insert = (row: Row) => {
            inserted = row;
            q.single = () => Promise.resolve({ data: { id: row.id }, error: null });
            return q;
          };
          return q;
        }
        if (table === "organizations") {
          return thenable({ data: { slug: "priya-stores", name: "Priya Stores" }, error: null });
        }
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        throw new Error(table);
      },
    };
    const result = await getMerchantCollectionLink(client as never, ctx);
    expect(inserted?.status).toBe("ACTIVE");
    expect(inserted?.public_workspace).toBe("priya-stores");
    expect(inserted?.public_code).toBe(hashedCustomerOrderPublicId("org-1"));
    expect(inserted?.expires_at).toBeNull();
    expect(result.url).toMatch(
      new RegExp(`/order/${hashedCustomerOrderPublicId("org-1")}/priya-stores/WhatsApp-order-form$`)
    );
  });
});

describe("getPublicCustomerOrderLink", () => {
  it("stays OPEN for an ACTIVE merchant link", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({ data: activeLink, error: null });
          const originalEq = q.eq as () => unknown;
          q.eq = (column: string, value: unknown) => {
            if (column === "token_hash") expect(value).toBe(HASH);
            return originalEq();
          };
          return q;
        }
        if (table === "organizations") {
          return thenable({ data: { name: "Priya Stores" }, error: null });
        }
        throw new Error(table);
      },
    };
    const view = await getPublicCustomerOrderLink(client as never, TOKEN_REF);
    expect(view.status).toBe("OPEN");
    expect(view.merchantName).toBe("Priya Stores");
  });

  it("resolves a workspace path to the ACTIVE merchant link", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        if (table === "organizations") return thenable({ data: { name: "Merchant A" }, error: null });
        throw new Error(table);
      },
    };
    await expect(getPublicCustomerOrderLink(client as never, PATH_REF)).resolves.toMatchObject({
      status: "OPEN",
      merchantName: "Merchant A",
    });
  });

  it("does not treat a used historical row as the live form", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          return thenable({
            data: { ...activeLink, status: "SUBMITTED" },
            error: null,
          });
        }
        throw new Error(table);
      },
    };
    await expect(getPublicCustomerOrderLink(client as never, TOKEN_REF)).resolves.toEqual({ status: "DISABLED" });
  });
});

describe("submitPublicCustomerOrderLink", () => {
  const payload = {
    customerName: "Rahul",
    phone: "9876543210",
    line1: "12 ABC House",
    city: "Kozhikode",
    state: "Kerala",
    pincode: "673001",
  };

  beforeEach(() => {
    vi.mocked(createManualOrder).mockClear();
  });

  it("creates a WHATSAPP order and leaves the merchant link ACTIVE", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        if (table === "notifications") return thenable({ data: { id: "n1" }, error: null });
        throw new Error(table);
      },
    };

    await expect(submitPublicCustomerOrderLink(client as never, PATH_REF, payload)).resolves.toMatchObject({
      status: "SUBMITTED",
      orderNumber: "#WA-PB-10001",
    });
    expect(createManualOrder).toHaveBeenCalledWith(
      client,
      { organizationId: "org-1", userId: null },
      expect.objectContaining({
        source: "WHATSAPP",
        status: "IMPORTED",
        paymentStatus: "PENDING",
        customer: expect.objectContaining({ name: "Rahul", phone: "9876543210" }),
      })
    );
  });

  it("creates a second order from the same merchant link", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        if (table === "notifications") return thenable({ data: { id: "n1" }, error: null });
        throw new Error(table);
      },
    };
    await submitPublicCustomerOrderLink(client as never, PATH_REF, payload);
    await submitPublicCustomerOrderLink(client as never, PATH_REF, {
      ...payload,
      customerName: "Anitha",
      phone: "8848772371",
    });
    expect(createManualOrder).toHaveBeenCalledTimes(2);
  });

  it("returns the first result when a storefront submission is retried with the same request id", async () => {
    let storedResponse: Record<string, unknown> | null = null;
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        if (table === "notifications") return thenable({ data: { id: "n1" }, error: null });
        if (table === "idempotency_keys") {
          const query = thenable({ data: null, error: null });
          query.maybeSingle = () =>
            Promise.resolve({
              data: storedResponse ? { request_hash: "hash", response: storedResponse } : null,
              error: null,
            });
          query.update = (patch: { response?: Record<string, unknown> }) => {
            if (patch.response) storedResponse = patch.response;
            return query;
          };
          return query;
        }
        throw new Error(table);
      },
    };
    const input = {
      ...payload,
      clientRequestId: "11111111-1111-4111-8111-111111111111",
    };
    const first = await submitPublicCustomerOrderLink(client as never, PATH_REF, input);
    const retried = await submitPublicCustomerOrderLink(client as never, PATH_REF, input);
    expect(retried).toEqual(first);
    expect(createManualOrder).toHaveBeenCalledTimes(1);
  });

  it("creates a catalog WhatsApp order without trusting client prices", async () => {
    vi.mocked(loadCatalogProducts).mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Premium T-Shirt",
        active: true,
        store_visible: true,
        prepaid_enabled: true,
        cod_enabled: true,
        inventory_balances: { on_hand: 5 },
      },
    ] as never);
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        if (table === "notifications") return thenable({ data: { id: "n1" }, error: null });
        throw new Error(table);
      },
    };
    const productId = "11111111-1111-4111-8111-111111111111";
    await submitPublicCustomerOrderLink(client as never, PATH_REF, {
      ...payload,
      paymentPreference: "COD",
      items: [{ productId, quantity: 2 }],
    });
    expect(createManualOrder).toHaveBeenCalledWith(
      client,
      { organizationId: "org-1", userId: null },
      expect.objectContaining({
        source: "WHATSAPP",
        paymentStatus: "PENDING",
        lineItems: [{ productId, quantity: 2 }],
        metadata: expect.objectContaining({
          storefront: expect.objectContaining({ paymentPreference: "COD" }),
        }),
      })
    );
  });

  it("rejects unpublished catalog products", async () => {
    vi.mocked(loadCatalogProducts).mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Hidden Tee",
        active: true,
        store_visible: false,
        inventory_balances: { on_hand: 5 },
      },
    ] as never);
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        throw new Error(table);
      },
    };
    await expect(
      submitPublicCustomerOrderLink(client as never, PATH_REF, {
        ...payload,
        items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
      })
    ).rejects.toBeInstanceOf(AppError);
    expect(createManualOrder).not.toHaveBeenCalled();
  });
});

describe("lookupPublicOrderLinkPincode", () => {
  beforeEach(() => {
    vi.mocked(indiaPostFromRow).mockReset();
  });

  it("returns India Post office city and state for an ACTIVE link", async () => {
    vi.mocked(indiaPostFromRow).mockReturnValue({
      searchPostOffices: vi.fn(async () => [
        {
          office_id: "22660454",
          office_name: "Kozhikode H.O",
          city_name: "Kozhikode",
          state_name: "Kerala",
          office_type_code: "HO",
          delivery_office_flag: true,
        },
      ]),
    } as never);
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") return thenable({ data: activeLink, error: null });
        if (table === "india_post_connections") {
          return thenable({
            data: { encrypted_username: "user", encrypted_password: "pass" },
            error: null,
          });
        }
        throw new Error(table);
      },
    };
    await expect(lookupPublicOrderLinkPincode(client as never, PATH_REF, "673001")).resolves.toEqual({
      pincode: "673001",
      offices: [{ name: "Kozhikode H.O", city: "Kozhikode", state: "Kerala" }],
    });
  });
});

describe("confirmLegacyCustomerOrderLink", () => {
  const submitted: Row = {
    id: "link-1",
    organization_id: "org-1",
    status: "SUBMITTED",
    expires_at: "2099-01-01T00:00:00.000Z",
    customer_name: "Rahul",
    phone: "9876543210",
    line1: "12 ABC House",
    line2: null,
    city: "Kozhikode",
    state: "Kerala",
    pincode: "673001",
    opened_at: null,
    submitted_at: "2026-10-06T00:00:00.000Z",
    confirmed_at: null,
    disabled_at: null,
    order_id: null,
    created_at: "2026-10-06T00:00:00.000Z",
    updated_at: "2026-10-06T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.mocked(createManualOrder).mockClear();
    vi.mocked(confirmWhatsAppOrder).mockClear();
  });

  it("creates a WHATSAPP order for a historical one-time submission", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({ data: submitted, error: null });
          q.update = () => thenable({ data: { ...submitted, status: "CONFIRMED" }, error: null });
          return q;
        }
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        throw new Error(table);
      },
    };
    const body = confirmCustomerOrderLinkSchema.parse({ paymentType: "COD", amount: 499 });
    const result = await confirmLegacyCustomerOrderLink(client as never, ctx, "link-1", body);
    expect(createManualOrder).toHaveBeenCalledWith(
      client,
      ctx,
      expect.objectContaining({
        source: "WHATSAPP",
        paymentStatus: "COD",
        status: "READY",
      })
    );
    expect(result.order).toMatchObject({ id: "order-1" });
  });
});
