import { describe, expect, it, vi } from "vitest";
import {
  BOUND_SUPPORT_EXPIRED,
  BOUND_SUPPORT_REJECTED,
  BOUND_SUPPORT_UNBOUND,
  getBoundSupportOrder,
} from "@/modules/vachat/support-order";
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
      rows = [...rows].sort((a, b) => dir * (Date.parse(String(a[col] ?? "")) - Date.parse(String(b[col] ?? "")) || String(a[col] ?? "").localeCompare(String(b[col] ?? ""))));
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
        return builder(table, { ...filters, eqs: [...((filters.eqs as Array<[string, string]>) ?? []), [column, value]] });
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

describe("getBoundSupportOrder", () => {
  it("returns only the bound order, shipment, and tracking", async () => {
    const supabase = fakeSupabase(sampleDb());
    const result = await getBoundSupportOrder(supabase as never, { sessionId: "sess-a", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.order_ref).toBe("PB-1001");
    expect(result.order.merchant_name).toBe("Zoura Parfums");
    expect(result.order.tracking_number).toBe("TRACKING-A");
    expect(result.order.last_event?.description).toBe("Item Bagged");
    expect(result.order.items).toEqual(["1x Perfume"]);
    expect(JSON.stringify(result.order)).not.toContain("ord-a");
    expect(result.order.tracking_number).not.toBe("TRACKING-B");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("ignores attacker-controlled order, org, merchant, tracking, and whatsapp fields", async () => {
    const result = await getBoundSupportOrder(fakeSupabase(sampleDb()) as never, {
      sessionId: "sess-a",
      now: NOW,
      order_id: "ord-b",
      organization_id: "org-b",
      merchant_id: "org-b",
      tracking_number: "TRACKING-B",
      whatsapp: "+919998887776",
      phone: PHONE_B,
      customer_id: "cust-b",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.order_ref).toBe("PB-1001");
    expect(result.order.tracking_number).toBe("TRACKING-A");
    expect(result.order.merchant_name).toBe("Zoura Parfums");
  });

  it("fails closed for expired, unbound, missing ids, and cross-tenant mismatch", async () => {
    const db = sampleDb();
    db.sessions[0].expires_at = "2026-10-05T00:00:00.000Z";
    await expect(getBoundSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", now: NOW })).resolves.toMatchObject({
      ok: false,
      code: BOUND_SUPPORT_EXPIRED,
    });

    const identify = sampleDb();
    identify.sessions[0].state = "IDENTIFY";
    identify.sessions[0].selected_order_id = null;
    identify.sessions[0].selected_organization_id = null;
    await expect(getBoundSupportOrder(fakeSupabase(identify) as never, { sessionId: "sess-a", now: NOW })).resolves.toMatchObject({
      ok: false,
      code: BOUND_SUPPORT_UNBOUND,
    });

    const unbound = sampleDb();
    unbound.sessions[0].state = "AWAIT_SELECTION";
    await expect(getBoundSupportOrder(fakeSupabase(unbound) as never, { sessionId: "sess-a", now: NOW })).resolves.toMatchObject({
      ok: false,
      code: BOUND_SUPPORT_UNBOUND,
    });

    const missing = sampleDb();
    missing.sessions[0].selected_order_id = null;
    await expect(getBoundSupportOrder(fakeSupabase(missing) as never, { sessionId: "sess-a", now: NOW })).resolves.toMatchObject({
      ok: false,
      code: BOUND_SUPPORT_UNBOUND,
    });

    const mismatch = sampleDb();
    mismatch.sessions[0].selected_organization_id = "org-b";
    await expect(getBoundSupportOrder(fakeSupabase(mismatch) as never, { sessionId: "sess-a", now: NOW })).resolves.toMatchObject({
      ok: false,
      code: BOUND_SUPPORT_REJECTED,
    });

    const otherCustomer = sampleDb();
    otherCustomer.sessions[0].selected_order_id = "ord-b";
    otherCustomer.sessions[0].selected_organization_id = "org-b";
    await expect(
      getBoundSupportOrder(fakeSupabase(otherCustomer) as never, { sessionId: "sess-a", now: NOW })
    ).resolves.toMatchObject({ ok: false, code: BOUND_SUPPORT_REJECTED });

    await expect(getBoundSupportOrder(fakeSupabase(sampleDb()) as never, { sessionId: "missing", now: NOW })).resolves.toMatchObject({
      ok: false,
      code: BOUND_SUPPORT_REJECTED,
    });
  });

  it("never returns another order's shipment or tracking", async () => {
    const db = sampleDb();
    db.shipments.push({
      id: "ship-a-wrong-org",
      organization_id: "org-b",
      order_id: "ord-a",
      status: "DELIVERED",
      tracking_number: "TRACKING-B",
      barcode: "TRACKING-B",
      booked_at: "2026-10-06T09:00:00.000Z",
      updated_at: "2026-10-06T09:00:00.000Z",
    });
    const result = await getBoundSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.tracking_number).toBe("TRACKING-A");
    expect(result.order.last_event?.office).toBe("Kochi HO");
    expect(result.order.last_event?.description).not.toBe("Item Booked");
  });

  it("returns a bound cancelled order without switching", async () => {
    const db = sampleDb();
    db.orders[0].status = "CANCELLED";
    const result = await getBoundSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.order_status).toBe("CANCELLED");
    expect(result.order.order_ref).toBe("PB-1001");
  });

  it("fails closed when the bound shipment is outside the 20-day window without unbinding", async () => {
    const db = sampleDb();
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    const result = await getBoundSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", now: NOW });
    expect(result).toMatchObject({ ok: false, code: BOUND_SUPPORT_REJECTED });
    expect(JSON.stringify(result)).not.toContain("ord-a");
    expect(JSON.stringify(result)).not.toContain("2026-09-15");
    expect(db.sessions[0].state).toBe("ORDER_BOUND");
    expect(db.sessions[0].selected_order_id).toBe("ord-a");
  });
});
