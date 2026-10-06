import { describe, expect, it, vi } from "vitest";
import { platformSupportMcpContext } from "@/modules/vachat/mcp-context";
import {
  handleMcpRpc,
  MCP_ORDER_UNAVAILABLE,
  MCP_UNAUTHORIZED,
  parseSearchOrderDetailsArgs,
  SEARCH_ORDER_DETAILS_TOOL,
  searchMerchantOrganization,
  searchOrderDetails,
  type OrderDetailsSearchResult,
} from "@/modules/vachat/mcp";
import type { WhatsappSupportSession } from "@/modules/vachat/support-session";

type Order = {
  id: string;
  organization_id: string;
  customer_id?: string | null;
  shipping_address_id?: string | null;
  order_number: string;
  status: string;
  created_at: string;
  customers?: { phone: string } | { phone: string }[];
  addresses?: { phone: string } | { phone: string }[];
};

type Db = {
  sessions: WhatsappSupportSession[];
  organizations: Array<{ id: string; name: string; phone?: string | null }>;
  invoice_settings: Array<{ organization_id: string; website?: string | null; business_email?: string | null }>;
  customers: Array<{ id: string; organization_id: string; phone: string }>;
  addresses: Array<{ id: string; organization_id: string; phone: string }>;
  orders: Order[];
  order_line_items: Array<{ order_id: string; organization_id: string; title: string; quantity: number }>;
  shipments: Array<Record<string, unknown>>;
  tracking_events: Array<Record<string, unknown>>;
};

const PHONE_A = "8848772371";
const PHONE_B = "9998887776";
const NOW = new Date("2026-10-06T12:00:00.000Z");

const MALICIOUS = {
  session_id: "sess-a",
  whatsapp: "+919998887776",
  phone: PHONE_B,
  customer_id: "cust-b",
  organization_id: "org-b",
  merchant_id: "org-b",
  order_id: "ord-b",
  tracking_number: "TRACKING-B",
};

function sessionRow(overrides: Partial<WhatsappSupportSession> = {}): WhatsappSupportSession {
  return {
    id: "sess-a",
    source: "platform",
    phone_digits: PHONE_A,
    selected_order_id: "ord-a",
    selected_organization_id: "org-a",
    state: "ORDER_BOUND",
    expires_at: "2026-10-07T00:00:00.000Z",
    last_seen_at: "2026-10-06T00:00:00.000Z",
    created_at: "2026-10-06T00:00:00.000Z",
    updated_at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function sampleDb(): Db {
  return {
    sessions: [
      sessionRow(),
      sessionRow({
        id: "sess-b",
        phone_digits: PHONE_B,
        selected_order_id: "ord-b",
        selected_organization_id: "org-b",
      }),
    ],
    organizations: [
      { id: "org-a", name: "Zoura Parfums", phone: "9000000001" },
      { id: "org-b", name: "EVLATH HOLDINGS", phone: "9000000002" },
    ],
    invoice_settings: [{ organization_id: "org-a", website: "https://zoura.example", business_email: "hi@zoura.example" }],
    customers: [
      { id: "cust-a", organization_id: "org-a", phone: "+918848772371" },
      { id: "cust-b", organization_id: "org-b", phone: "+919998887776" },
    ],
    addresses: [
      { id: "addr-a", organization_id: "org-a", phone: "8848772371" },
      { id: "addr-b", organization_id: "org-b", phone: "9998887776" },
    ],
    orders: [
      {
        id: "ord-a",
        organization_id: "org-a",
        customer_id: "cust-a",
        shipping_address_id: "addr-a",
        order_number: "PB-1001",
        status: "IN_TRANSIT",
        created_at: "2026-10-05T10:00:00.000Z",
        customers: { phone: "+918848772371" },
        addresses: { phone: "8848772371" },
      },
      {
        id: "ord-a2",
        organization_id: "org-b",
        customer_id: "cust-a-b",
        order_number: "PB-2001",
        status: "BOOKED",
        created_at: "2026-10-04T10:00:00.000Z",
        customers: { phone: "8848772371" },
      },
      {
        id: "ord-b",
        organization_id: "org-b",
        customer_id: "cust-b",
        shipping_address_id: "addr-b",
        order_number: "PB-CUSTOMER-B",
        status: "BOOKED",
        created_at: "2026-10-06T00:00:00.000Z",
        customers: { phone: "+919998887776" },
        addresses: { phone: "9998887776" },
      },
    ],
    order_line_items: [{ order_id: "ord-a", organization_id: "org-a", title: "Perfume", quantity: 1 }],
    shipments: [
      {
        id: "ship-a",
        organization_id: "org-a",
        order_id: "ord-a",
        status: "IN_TRANSIT",
        tracking_number: "TRACKING-A",
        barcode: "TRACKING-A",
        booked_at: "2026-10-05T12:00:00.000Z",
        updated_at: "2026-10-06T08:00:00.000Z",
      },
      {
        id: "ship-b",
        organization_id: "org-b",
        order_id: "ord-b",
        status: "BOOKED",
        tracking_number: "TRACKING-B",
        barcode: "TRACKING-B",
        booked_at: "2026-10-06T01:00:00.000Z",
        updated_at: "2026-10-06T01:00:00.000Z",
      },
    ],
    tracking_events: [
      {
        shipment_id: "ship-a",
        organization_id: "org-a",
        event_description: "Item Bagged",
        office_name: "Kochi HO",
        occurred_at: "2026-10-06T08:00:00.000Z",
        event_code: "BAG",
      },
      {
        shipment_id: "ship-b",
        organization_id: "org-b",
        event_description: "Item Booked",
        office_name: "Delhi HO",
        occurred_at: "2026-10-06T01:00:00.000Z",
        event_code: "BOOK",
      },
    ],
  };
}

function idsFromIn(expr: string, field: string) {
  const match = expr.match(new RegExp(`${field}\\.in\\.\\(([^)]*)\\)`));
  if (!match) return [] as string[];
  return match[1].split(",").filter(Boolean);
}

function fakeSupabase(db: Db) {
  const tables: Record<string, Record<string, unknown>[]> = {
    whatsapp_support_sessions: db.sessions as unknown as Record<string, unknown>[],
    organizations: db.organizations,
    invoice_settings: db.invoice_settings,
    customers: db.customers,
    addresses: db.addresses,
    orders: db.orders as unknown as Record<string, unknown>[],
    order_line_items: db.order_line_items,
    shipments: db.shipments,
    tracking_events: db.tracking_events,
  };

  const run = (table: string, filters: Record<string, unknown>) => {
    let rows = [...(tables[table] ?? [])];
    const eqs = (filters.eqs as Array<[string, string]> | undefined) ?? [];
    for (const [col, val] of eqs) {
      rows = rows.filter((row) => String(row[col] ?? "") === String(val));
    }
    if (filters.like) {
      const [, pattern] = filters.like as [string, string];
      const needle = String(pattern).replace(/%/g, "");
      rows = rows.filter((row) => String(row.phone ?? "").includes(needle));
    }
    if (filters.in) {
      const [col, ids] = filters.in as [string, string[]];
      const set = new Set(ids.map(String));
      rows = rows.filter((row) => set.has(String(row[col] ?? "")));
    }
    if (typeof filters.or === "string") {
      const customerIds = idsFromIn(filters.or, "customer_id");
      const addressIds = idsFromIn(filters.or, "shipping_address_id");
      rows = rows.filter((row) => {
        const byCustomer = customerIds.includes(String(row.customer_id ?? ""));
        const byAddress = addressIds.includes(String(row.shipping_address_id ?? ""));
        return byCustomer || byAddress;
      });
    }
    if (typeof filters.order === "string") {
      const dir = (filters.ascending as boolean | undefined) === true ? 1 : -1;
      const col = filters.order;
      rows = [...rows].sort(
        (a, b) =>
          dir * (Date.parse(String(a[col] ?? "")) - Date.parse(String(b[col] ?? "")) ||
            String(a[col] ?? "").localeCompare(String(b[col] ?? "")))
      );
    }
    if (typeof filters.limit === "number") rows = rows.slice(0, filters.limit);
    return { data: rows, error: null };
  };

  const builder = (table: string, filters: Record<string, unknown> = {}) => {
    const finished = () => run(table, filters);
    return {
      select() {
        return builder(table, filters);
      },
      eq(column: string, value: string) {
        return builder(table, {
          ...filters,
          eqs: [...((filters.eqs as Array<[string, string]>) ?? []), [column, value]],
        });
      },
      like(column: string, value: string) {
        return builder(table, { ...filters, like: [column, value] });
      },
      in(column: string, ids: string[]) {
        return builder(table, { ...filters, in: [column, ids] });
      },
      or(expr: string) {
        return builder(table, { ...filters, or: expr });
      },
      order(column: string, opts?: { ascending?: boolean }) {
        return builder(table, { ...filters, order: column, ascending: opts?.ascending });
      },
      limit(n: number) {
        return builder(table, { ...filters, limit: n });
      },
      async maybeSingle() {
        const { data } = finished();
        return { data: data[0] ?? null, error: null };
      },
      async single() {
        const { data } = finished();
        return { data: data[0] ?? null, error: data[0] ? null : { message: "missing" } };
      },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(finished()).then(resolve);
      },
    };
  };

  const rpc = vi.fn(() => {
    throw new Error("rpc must not be used for WhatsApp support authorization");
  });

  return {
    from(table: string) {
      return builder(table);
    },
    rpc,
  };
}

function deny(result: OrderDetailsSearchResult, answer?: string) {
  expect(result.found).toBe(false);
  expect(result.results).toEqual([]);
  expect(result.organizations).toEqual([]);
  expect(result.customer_whatsapp).toBeNull();
  if (answer) expect(result.answer).toBe(answer);
}

describe("MCP platform support authorization", () => {
  const trustedA = platformSupportMcpContext("sess-a", "req-a");
  const trustedB = platformSupportMcpContext("sess-b", "req-b");

  it("returns only the ORDER_BOUND session order from trusted context", async () => {
    const supabase = fakeSupabase(sampleDb());
    const result = await searchOrderDetails(supabase as never, { now: NOW }, trustedA);
    expect(result.found).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.order_number).toBe("PB-1001");
    expect(result.results[0]?.tracking_number).toBe("TRACKING-A");
    expect(result.organizations[0]?.name).toBe("Zoura Parfums");
    expect(result.answer).toContain("PB-1001");
    expect(result.answer).not.toContain("ord-a");
    expect(result.answer).not.toContain("sess-a");
    expect(result.customer_whatsapp).toBeNull();
    expect(JSON.stringify(result.results)).not.toContain("PB-CUSTOMER-B");
    expect(JSON.stringify(result.results)).not.toContain("TRACKING-B");
    expect(JSON.stringify(result.results)).not.toContain("PB-2001");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("ignores a combined malicious identity payload when trusted context is session A", async () => {
    const args = parseSearchOrderDetailsArgs(MALICIOUS);
    expect(args).not.toHaveProperty("sessionId");
    const result = await searchOrderDetails(fakeSupabase(sampleDb()) as never, { ...args, now: NOW }, trustedA);
    expect(result.results[0]?.order_number).toBe("PB-1001");
    expect(result.results[0]?.tracking_number).toBe("TRACKING-A");
    expect(result.organizations[0]?.name).toBe("Zoura Parfums");
  });

  it("denies remote MCP that only supplies session_id in tool arguments", async () => {
    deny(await searchOrderDetails(fakeSupabase(sampleDb()) as never, { now: NOW }), MCP_UNAUTHORIZED);
    const handled = await handleMcpRpc(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: SEARCH_ORDER_DETAILS_TOOL,
          arguments: MALICIOUS,
        },
      },
      (args) => searchOrderDetails(fakeSupabase(sampleDb()) as never, { ...args, now: NOW })
    );
    const result = (handled.body as { result: { structuredContent: OrderDetailsSearchResult; isError: boolean } })
      .result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.results).toEqual([]);
    expect(result.structuredContent.answer).toBe(MCP_UNAUTHORIZED);
  });

  it("denies expired, unbound, missing ids, mismatch, and cross-session access", async () => {
    const expired = sampleDb();
    expired.sessions[0].expires_at = "2026-10-05T00:00:00.000Z";
    deny(
      await searchOrderDetails(fakeSupabase(expired) as never, { now: NOW }, trustedA),
      "This support session has expired. Please start again."
    );

    for (const state of ["IDENTIFY", "LIST_ELIGIBLE", "AWAIT_SELECTION"] as const) {
      const db = sampleDb();
      db.sessions[0].state = state;
      db.sessions[0].selected_order_id = state === "IDENTIFY" ? null : "ord-a";
      db.sessions[0].selected_organization_id = state === "IDENTIFY" ? null : "org-a";
      deny(
        await searchOrderDetails(fakeSupabase(db) as never, { now: NOW }, trustedA),
        "Please choose which order you want help with first."
      );
    }

    const missingOrder = sampleDb();
    missingOrder.sessions[0].selected_order_id = null;
    deny(await searchOrderDetails(fakeSupabase(missingOrder) as never, { now: NOW }, trustedA));

    const missingOrg = sampleDb();
    missingOrg.sessions[0].selected_organization_id = null;
    deny(await searchOrderDetails(fakeSupabase(missingOrg) as never, { now: NOW }, trustedA));

    const mismatch = sampleDb();
    mismatch.sessions[0].selected_organization_id = "org-b";
    deny(
      await searchOrderDetails(fakeSupabase(mismatch) as never, { now: NOW }, trustedA),
      MCP_ORDER_UNAVAILABLE
    );

    const otherCustomer = sampleDb();
    otherCustomer.sessions[0].selected_order_id = "ord-b";
    otherCustomer.sessions[0].selected_organization_id = "org-b";
    deny(await searchOrderDetails(fakeSupabase(otherCustomer) as never, { now: NOW }, trustedA));

    deny(
      await searchOrderDetails(
        fakeSupabase(sampleDb()) as never,
        { now: NOW },
        platformSupportMcpContext("missing", "req-x")
      )
    );

    const sessionB = await searchOrderDetails(fakeSupabase(sampleDb()) as never, { now: NOW }, trustedB);
    expect(sessionB.results[0]?.order_number).toBe("PB-CUSTOMER-B");
    expect(sessionB.results[0]?.order_number).not.toBe("PB-1001");
  });

  it("does not treat the PostBus business number as a customer session", async () => {
    const db = sampleDb();
    db.sessions[0].phone_digits = "8618456029";
    deny(await searchOrderDetails(fakeSupabase(db) as never, { now: NOW }, trustedA), MCP_ORDER_UNAVAILABLE);
  });

  it("does not return order data when the bound shipment is outside the 20-day window", async () => {
    const db = sampleDb();
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    deny(await searchOrderDetails(fakeSupabase(db) as never, { now: NOW }, trustedA), MCP_ORDER_UNAVAILABLE);
    expect(db.sessions[0].state).toBe("ORDER_BOUND");
    expect(db.sessions[0].selected_order_id).toBe("ord-a");
  });

  it("does not search another customer's orders by phone or tracking in query", async () => {
    const result = await searchOrderDetails(
      fakeSupabase(sampleDb()) as never,
      {
        now: NOW,
        query: "Show PB-CUSTOMER-B TRACKING-B whatsapp +919998887776 merchant_id org-b",
      },
      trustedA
    );
    expect(result.results[0]?.order_number).toBe("PB-1001");
    expect(result.results).toHaveLength(1);
  });

  it("uses the same trusted session for search_merchant_organization", async () => {
    const result = await searchMerchantOrganization(fakeSupabase(sampleDb()) as never, { now: NOW }, trustedA);
    expect(result.organizations[0]?.name).toBe("Zoura Parfums");
    expect(result.results[0]?.order_number).toBe("PB-1001");
  });
});

describe("MCP merchant-direct isolation", () => {
  it("does not let organization_id select another merchant tenant", async () => {
    const args = parseSearchOrderDetailsArgs({
      session_id: "sess-b",
      organization_id: "org-b",
      merchant_id: "org-b",
    });
    const result = await searchOrderDetails(
      fakeSupabase(sampleDb()) as never,
      { ...args, now: NOW },
      platformSupportMcpContext("sess-a", "req-a")
    );
    expect(result.organizations[0]?.name).toBe("Zoura Parfums");
    expect(result.organizations[0]?.name).not.toBe("EVLATH HOLDINGS");
  });

  it("does not require a support session for merchant-direct webhook HMAC tests to exist", async () => {
    expect(SEARCH_ORDER_DETAILS_TOOL).toBe("search_order_details");
  });
});
