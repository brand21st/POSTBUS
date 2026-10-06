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
  customerOrderLinkPublicId,
  customerOrderLinkTokenSchema,
  parseCustomerOrderLinkParts,
  submitCustomerOrderLinkSchema,
} from "@/modules/customer-order-links/schema";
import {
  confirmCustomerOrderLink,
  createCustomerOrderLink,
  disableCustomerOrderLink,
} from "@/modules/customer-order-links/service";

import { createManualOrder } from "@/modules/orders/service";
import { indiaPostFromRow } from "@/modules/india-post/provider";

vi.mock("@/modules/orders/service", () => ({
  createManualOrder: vi.fn(async () => ({ id: "order-1", order_number: "PB-10001" })),
}));

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(),
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
    single: () => Promise.resolve({ data: result.data, error: result.error }),
    maybeSingle: () => Promise.resolve({ data: result.data, error: result.error }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: result.data, error: result.error, count: result.count ?? null }).then(resolve, reject),
  };
  return query;
}

describe("customer order link schemas", () => {
  it("accepts hyphenated readable tokens and 64-char hex tokens", () => {
    expect(customerOrderLinkTokenSchema.parse("K7XM-P2NQ-W4HT-S8C3")).toBe("k7xm-p2nq-w4ht-s8c3");
    expect(customerOrderLinkTokenSchema.parse("A".repeat(64))).toBe("a".repeat(64));
  });

  it("builds a shareable WhatsApp form path with workspace and order id", () => {
    expect(customerOrderLinkPath("priya-stores", "0081")).toBe("/order/priya-stores/0081/whatsapp-order-form");
    expect(parseCustomerOrderLinkParts(["Priya-Stores", "0081", "whatsapp-order-form"])).toEqual({
      workspace: "priya-stores",
      publicId: "0081",
    });
    expect(customerOrderLinkPublicId("3f2a9c1b-4d5e-6789-abcd-ef0123456789")).toBe("3f2a");
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

  it("rejects a bad pin and phone", () => {
    expect(() =>
      submitCustomerOrderLinkSchema.parse({
        customerName: "Rahul",
        phone: "123",
        line1: "12 ABC House",
        city: "Kozhikode",
        state: "Kerala",
        pincode: "6730",
      })
    ).toThrow();
  });
});

describe("createCustomerOrderLink", () => {
  it("stores a hashed token and returns the public URL once", async () => {
    let inserted: Row | null = null;
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({
            data: { id: "3f2a9c1b-4d5e-6789-abcd-ef0123456789", expires_at: "2026-10-13T00:00:00.000Z" },
            error: null,
          });
          q.insert = (row: Row) => {
            inserted = row;
            q.single = () =>
              Promise.resolve({
                data: { id: row.id, expires_at: "2026-10-13T00:00:00.000Z" },
                error: null,
              });
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

    const result = await createCustomerOrderLink(client as never, ctx);
    expect(result.id).toBe(inserted?.id);
    expect(result.url).toMatch(/\/order\/priya-stores\/[a-f0-9]{4}\/whatsapp-order-form$/);
    expect(inserted?.public_workspace).toBe("priya-stores");
    expect(inserted?.public_code).toMatch(/^[a-f0-9]{4}$/);
    expect(inserted?.token_hash).toEqual(expect.any(String));
    expect(inserted?.organization_id).toBe("org-1");
    expect(inserted?.status).toBe("CREATED");
  });
});

describe("getPublicCustomerOrderLink", () => {
  it("opens a created link", async () => {
    const updates: Row[] = [];
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({
            data: {
              id: "link-1",
              organization_id: "org-1",
              status: "CREATED",
              expires_at: "2099-01-01T00:00:00.000Z",
            },
            error: null,
          });
          const originalEq = q.eq as () => unknown;
          q.eq = (column: string, value: unknown) => {
            if (column === "token_hash") expect(value).toBe(HASH);
            return originalEq();
          };
          q.update = (row: Row) => {
            updates.push(row);
            return q;
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
    expect(updates[0]).toMatchObject({ status: "OPENED" });
  });

  it("hides details after submit", async () => {
    const client = {
      from: () =>
        thenable({
          data: {
            id: "link-1",
            organization_id: "org-1",
            status: "SUBMITTED",
            expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        }),
    };
    await expect(getPublicCustomerOrderLink(client as never, TOKEN_REF)).resolves.toEqual({ status: "SUBMITTED" });
  });

  it("returns expired for past expiry", async () => {
    const client = {
      from: () =>
        thenable({
          data: {
            id: "link-1",
            organization_id: "org-1",
            status: "OPENED",
            expires_at: "2020-01-01T00:00:00.000Z",
          },
          error: null,
        }),
    };
    await expect(getPublicCustomerOrderLink(client as never, TOKEN_REF)).resolves.toEqual({ status: "EXPIRED" });
  });

  it("rejects an invalid token format", async () => {
    await expect(getPublicCustomerOrderLink({} as never, { kind: "token", token: "short" })).rejects.toBeInstanceOf(AppError);
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

  it("writes the snapshot when the link is still open", async () => {
    let updated: Row | null = null;
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({
            data: {
              id: "link-1",
              organization_id: "org-1",
              status: "OPENED",
              expires_at: "2099-01-01T00:00:00.000Z",
            },
            error: null,
          });
          q.update = (row: Row) => {
            updated = row;
            q.maybeSingle = () => Promise.resolve({ data: { id: "link-1" }, error: null });
            return q;
          };
          return q;
        }
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        throw new Error(table);
      },
    };

    await expect(submitPublicCustomerOrderLink(client as never, TOKEN_REF, payload)).resolves.toEqual({
      status: "SUBMITTED",
    });
    expect(updated).toMatchObject({
      status: "SUBMITTED",
      customer_name: "Rahul",
      phone: "9876543210",
      pincode: "673001",
    });
  });

  it("blocks a second submit", async () => {
    const client = {
      from: () =>
        thenable({
          data: {
            id: "link-1",
            organization_id: "org-1",
            status: "SUBMITTED",
            expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        }),
    };
    await expect(submitPublicCustomerOrderLink(client as never, TOKEN_REF, payload)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("lookupPublicOrderLinkPincode", () => {
  const openLink = {
    id: "link-1",
    organization_id: "org-1",
    status: "OPENED",
    expires_at: "2099-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.mocked(indiaPostFromRow).mockReset();
  });

  it("returns India Post office city and state for an open link", async () => {
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
        if (table === "customer_order_links") return thenable({ data: openLink, error: null });
        if (table === "india_post_connections") {
          return thenable({
            data: { encrypted_username: "user", encrypted_password: "pass" },
            error: null,
          });
        }
        throw new Error(table);
      },
    };
    await expect(lookupPublicOrderLinkPincode(client as never, TOKEN_REF, "673001")).resolves.toEqual({
      pincode: "673001",
      offices: [{ name: "Kozhikode H.O", city: "Kozhikode", state: "Kerala" }],
    });
  });

  it("does not look up PIN after the customer has submitted", async () => {
    const client = {
      from: () =>
        thenable({
          data: { ...openLink, status: "SUBMITTED" },
          error: null,
        }),
    };
    await expect(lookupPublicOrderLinkPincode(client as never, TOKEN_REF, "673001")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(indiaPostFromRow).not.toHaveBeenCalled();
  });
});

describe("confirmCustomerOrderLink", () => {
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
    orders: null,
  };

  beforeEach(() => {
    vi.mocked(createManualOrder).mockClear();
    vi.mocked(indiaPostFromRow).mockClear();
  });

  it("creates a MANUAL COD order for the same organization", async () => {
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({ data: submitted, error: null });
          q.update = (row: Row) => {
            const next = thenable({
              data: { ...submitted, status: "CONFIRMED", order_id: "order-1", ...row },
              error: null,
            });
            return next;
          };
          return q;
        }
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        throw new Error(table);
      },
    };

    const body = confirmCustomerOrderLinkSchema.parse({ paymentType: "COD", amount: 499 });
    const result = await confirmCustomerOrderLink(client as never, ctx, "link-1", body);
    expect(createManualOrder).toHaveBeenCalledWith(
      client,
      ctx,
      expect.objectContaining({
        source: "MANUAL",
        paymentStatus: "COD",
        customer: expect.objectContaining({ name: "Rahul", phone: "9876543210" }),
        lineItems: [expect.objectContaining({ title: "Manual order", unitPrice: 499 })],
      })
    );
    expect(result.order).toMatchObject({ id: "order-1" });
    expect(result.link.status).toBe("CONFIRMED");
  });

  it("does not confirm another organization's link", async () => {
    const client = {
      from: () => thenable({ data: null, error: null }),
    };
    await expect(
      confirmCustomerOrderLink(
        client as never,
        ctx,
        "link-other",
        confirmCustomerOrderLinkSchema.parse({ paymentType: "PREPAID", amount: 100 })
      )
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(createManualOrder).not.toHaveBeenCalled();
  });
});

describe("disableCustomerOrderLink", () => {
  it("marks an unused link disabled", async () => {
    const row = {
      id: "link-1",
      organization_id: "org-1",
      status: "CREATED",
      expires_at: "2099-01-01T00:00:00.000Z",
      customer_name: null,
      phone: null,
      line1: null,
      line2: null,
      city: null,
      state: null,
      pincode: null,
      opened_at: null,
      submitted_at: null,
      confirmed_at: null,
      disabled_at: null,
      order_id: null,
      created_at: "2026-10-06T00:00:00.000Z",
      updated_at: "2026-10-06T00:00:00.000Z",
    };
    const client = {
      from: (table: string) => {
        if (table === "customer_order_links") {
          const q = thenable({ data: row, error: null });
          q.update = () => thenable({ data: { ...row, status: "DISABLED" }, error: null });
          return q;
        }
        if (table === "audit_logs") return thenable({ data: { id: "a1" }, error: null });
        throw new Error(table);
      },
    };
    const result = await disableCustomerOrderLink(client as never, ctx, "link-1");
    expect(result.status).toBe("DISABLED");
  });
});
