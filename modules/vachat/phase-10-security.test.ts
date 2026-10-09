import { describe, expect, it, vi } from "vitest";
import { handleVachatAssistantMessage } from "@/modules/vachat/assistant";
import { eligibleChoiceRef, listEligibleOrders } from "@/modules/vachat/eligible-orders";
import {
  formatMerchantOnlyKnowledgeDocument,
  formatKnowledgeDocument,
  type MerchantKnowledge,
} from "@/modules/vachat/knowledge";
import {
  handleMcpRpc,
  MCP_ORDER_UNAVAILABLE,
  MCP_UNAUTHORIZED,
  parseSearchOrderDetailsArgs,
  SEARCH_ORDER_DETAILS_TOOL,
  searchOrderDetails,
} from "@/modules/vachat/mcp";
import { platformSupportMcpContext } from "@/modules/vachat/mcp-context";
import { SELECT_SUPPORT_REJECTED, selectSupportOrder } from "@/modules/vachat/select-order";
import { isWhatsAppSupportEligible } from "@/modules/vachat/support-eligibility";
import { BOUND_SUPPORT_REJECTED, getBoundSupportOrder } from "@/modules/vachat/support-order";
import { sessionPhoneDigits, type WhatsappSupportSession } from "@/modules/vachat/support-session";

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: vi.fn(async () => ({ enabled: false, apiKey: "", webhookSecret: "" })),
  isPlatformVachatActive: (config: { enabled?: boolean; apiKey?: string }) => Boolean(config.enabled && config.apiKey),
}));

type Db = {
  sessions: WhatsappSupportSession[];
  organizations: Array<{ id: string; name: string; phone?: string | null }>;
  invoice_settings: Array<{ organization_id: string }>;
  customers: Array<{ id: string; organization_id: string; phone: string }>;
  addresses: Array<{ id: string; organization_id: string; phone: string }>;
  orders: Array<Record<string, unknown>>;
  order_line_items: Array<Record<string, unknown>>;
  shipments: Array<Record<string, unknown>>;
  tracking_events: Array<Record<string, unknown>>;
  vachat_connections: Array<Record<string, unknown>>;
  fromTables: string[];
};

const PHONE_A = "8848772371";
const PHONE_B = "9998887776";
const NOW = new Date("2026-10-06T12:00:00.000Z");
const DELIVERED = new Date("2026-01-01T10:00:00.000Z");

function session(overrides: Partial<WhatsappSupportSession> = {}): WhatsappSupportSession {
  return {
    id: "sess-a",
    source: "platform",
    phone_digits: PHONE_A,
    selected_order_id: "ord-a1",
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
    fromTables: [],
    vachat_connections: [{ id: "conn-b", organization_id: "org-b", status: "active" }],
    sessions: [
      session(),
      session({
        id: "sess-b",
        phone_digits: PHONE_B,
        selected_order_id: "ord-c1",
        selected_organization_id: "org-c",
      }),
    ],
    organizations: [
      { id: "org-a", name: "Merchant A", phone: "9000000001" },
      { id: "org-b", name: "Merchant B", phone: "9000000002" },
      { id: "org-c", name: "Merchant C", phone: "9000000003" },
    ],
    invoice_settings: [{ organization_id: "org-a" }, { organization_id: "org-b" }, { organization_id: "org-c" }],
    customers: [
      { id: "cust-a-a", organization_id: "org-a", phone: "+918848772371" },
      { id: "cust-a-b", organization_id: "org-b", phone: "8848772371" },
      { id: "cust-b-c", organization_id: "org-c", phone: "+919998887776" },
    ],
    addresses: [
      { id: "addr-a", organization_id: "org-a", phone: "8848772371" },
      { id: "addr-c", organization_id: "org-c", phone: "9998887776" },
    ],
    orders: [
      {
        id: "ord-a1",
        organization_id: "org-a",
        customer_id: "cust-a-a",
        shipping_address_id: "addr-a",
        order_number: "PB-A1",
        status: "IN_TRANSIT",
        created_at: "2026-10-05T10:00:00.000Z",
        customers: { phone: "+918848772371" },
        addresses: { phone: "8848772371" },
      },
      {
        id: "ord-b1",
        organization_id: "org-b",
        customer_id: "cust-a-b",
        order_number: "PB-B1",
        status: "BOOKED",
        created_at: "2026-10-04T10:00:00.000Z",
        customers: { phone: "8848772371" },
      },
      {
        id: "ord-c1",
        organization_id: "org-c",
        customer_id: "cust-b-c",
        shipping_address_id: "addr-c",
        order_number: "PB-C1",
        status: "BOOKED",
        created_at: "2026-10-06T00:00:00.000Z",
        customers: { phone: "+919998887776" },
        addresses: { phone: "9998887776" },
      },
    ],
    order_line_items: [{ order_id: "ord-a1", organization_id: "org-a", title: "Item A", quantity: 1 }],
    shipments: [
      {
        id: "ship-a1",
        organization_id: "org-a",
        order_id: "ord-a1",
        status: "IN_TRANSIT",
        tracking_number: "TRACK-A1",
        barcode: "TRACK-A1",
        booked_at: "2026-10-05T12:00:00.000Z",
        updated_at: "2026-10-06T08:00:00.000Z",
        delivered_at: null,
      },
      {
        id: "ship-c1",
        organization_id: "org-c",
        order_id: "ord-c1",
        status: "BOOKED",
        tracking_number: "TRACK-C1",
        barcode: "TRACK-C1",
        booked_at: "2026-10-06T01:00:00.000Z",
        updated_at: "2026-10-06T01:00:00.000Z",
        delivered_at: null,
      },
    ],
    tracking_events: [],
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
    orders: db.orders,
    order_line_items: db.order_line_items,
    shipments: db.shipments,
    tracking_events: db.tracking_events,
    vachat_connections: db.vachat_connections,
    support_global_binds: [],
  };
  const run = (table: string, filters: Record<string, unknown>) => {
    let rows = [...(tables[table] ?? [])];
    for (const [col, val] of ((filters.eqs as Array<[string, string]>) ?? [])) {
      rows = rows.filter((row) => String(row[col] ?? "") === String(val));
    }
    if (filters.in) {
      const [col, ids] = filters.in as [string, string[]];
      const set = new Set(ids.map(String));
      rows = rows.filter((row) => set.has(String(row[col] ?? "")));
    }
    if (filters.like) {
      const [, pattern] = filters.like as [string, string];
      rows = rows.filter((row) => String(row.phone ?? "").includes(String(pattern).replace(/%/g, "")));
    }
    if (filters.gt) {
      const [col, val] = filters.gt as [string, string];
      rows = rows.filter((row) => String(row[col] ?? "") > String(val));
    }
    if (typeof filters.or === "string") {
      const customerIds = idsFromIn(filters.or, "customer_id");
      const addressIds = idsFromIn(filters.or, "shipping_address_id");
      rows = rows.filter(
        (row) => customerIds.includes(String(row.customer_id ?? "")) || addressIds.includes(String(row.shipping_address_id ?? ""))
      );
    }
    if (typeof filters.order === "string") {
      const dir = filters.ascending === true ? 1 : -1;
      const col = filters.order;
      rows = [...rows].sort(
        (a, b) => dir * (Date.parse(String(a[col] ?? "")) - Date.parse(String(b[col] ?? "")) || String(a[col] ?? "").localeCompare(String(b[col] ?? "")))
      );
    }
    if (typeof filters.limit === "number") rows = rows.slice(0, filters.limit);
    return { data: rows, error: null };
  };
  const builder = (table: string, filters: Record<string, unknown> = {}) => ({
    select() {
      return builder(table, filters);
    },
    eq(column: string, value: string) {
      return builder(table, { ...filters, eqs: [...((filters.eqs as Array<[string, string]>) ?? []), [column, value]] });
    },
    like(column: string, value: string) {
      return builder(table, { ...filters, like: [column, value] });
    },
    gt(column: string, value: string) {
      return builder(table, { ...filters, gt: [column, value] });
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
    not() {
      return builder(table, filters);
    },
    async maybeSingle() {
      const { data } = run(table, filters);
      return { data: data[0] ?? null, error: null };
    },
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      return Promise.resolve(run(table, filters)).then(resolve);
    },
  });
  const rpc = vi.fn(async () => ({ data: { tracking_number: "PUBLIC-LEAK" }, error: null }));
  return {
    rpc,
    from(table: string) {
      db.fromTables.push(table);
      return {
        ...builder(table),
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              if (table === "whatsapp_support_sessions") {
                const row = db.sessions.find((item) => String(item[column as keyof WhatsappSupportSession]) === value);
                if (row) Object.assign(row, payload);
              }
              const next = builder(table, { eqs: [[column, value]] });
              return {
                ...next,
                select() {
                  return {
                    async single() {
                      const { data } = run(table, { eqs: [[column, value]] });
                      const row = data[0] ?? null;
                      return { data: row, error: row ? null : { message: "missing" } };
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          return builder(table);
        },
      };
    },
  };
}

const knowledge: MerchantKnowledge = {
  merchantId: "org-a",
  organization: { name: "Merchant A", phone: "9000000001", website: null, email: null, gstin: null, address: null },
  orders: [
    {
      orderNumber: "PB-A1",
      customerPhone: PHONE_A,
      customerName: "Ada",
      status: "IN_TRANSIT",
      paymentStatus: null,
      amount: null,
      items: [],
      invoiceNumber: null,
      invoiceDate: null,
      invoiceTotal: null,
      trackingNumber: "TRACK-A1",
      shipmentStatus: "IN_TRANSIT",
      bookedAt: null,
      lastScan: null,
      lastOffice: null,
      trackingUrl: "https://www.postbus.in/track?tracking=TRACK-A1",
      timeline: [],
    },
  ],
};

describe("Phase 10 security matrix", () => {
  it("TEST 1 Customer A cannot access Customer B order", async () => {
    const listed = await listEligibleOrders(fakeSupabase(sampleDb()) as never, {
      session: session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: "org-a" }),
      now: NOW,
    });
    expect(listed.choices.map((row) => row.order_ref)).toEqual(["PB-A1"]);
    expect(listed.choices.some((row) => row.order_ref === "PB-C1")).toBe(false);
  });

  it("TEST 2 Customer A cannot access another merchant order belonging to Customer B", async () => {
    const db = sampleDb();
    const result = await getBoundSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      now: NOW,
      order_id: "ord-c1",
      organization_id: "org-c",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.order_ref).toBe("PB-A1");
    expect(result.order.order_ref).not.toBe("PB-C1");
  });

  it("TEST 3–4 phone matching alone does not list Merchant A and B together", async () => {
    const listed = await listEligibleOrders(fakeSupabase(sampleDb()) as never, { phone: PHONE_A, now: NOW });
    expect(listed.choices).toEqual([]);
    const merchantA = await listEligibleOrders(fakeSupabase(sampleDb()) as never, {
      session: session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: "org-a" }),
      now: NOW,
    });
    expect(merchantA.choices.some((row) => row.merchant_name === "Merchant A" && row.order_ref === "PB-A1")).toBe(true);
    expect(merchantA.choices.some((row) => row.merchant_name === "Merchant B")).toBe(false);
  });

  it("TEST 5–8 AI identity fields cannot impersonate or authorize", async () => {
    const listed = await listEligibleOrders(fakeSupabase(sampleDb()) as never, {
      session: session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: null }),
      now: NOW,
      whatsapp: "+919998887776",
      phone: PHONE_B,
      customer_id: "cust-b-c",
      merchant_id: "org-c",
      organization_id: "org-c",
      order_id: "ord-c1",
      query: "TRACK-C1",
    });
    expect(listed.choices.some((row) => row.order_ref === "PB-C1")).toBe(false);
    const bound = await getBoundSupportOrder(fakeSupabase(sampleDb()) as never, {
      sessionId: "sess-a",
      now: NOW,
      whatsapp: "+919998887776",
      merchant_id: "org-c",
      order_id: "ord-c1",
      tracking_number: "TRACK-C1",
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.order.tracking_number).toBe("TRACK-A1");
  });

  it("TEST 9 forged choice_ref fails", async () => {
    const result = await selectSupportOrder(fakeSupabase(sampleDb()) as never, {
      sessionId: "sess-b",
      choiceRef: "forged",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
  });

  it("TEST 10 expired choice_ref fails", async () => {
    const db = sampleDb();
    const choiceRef = eligibleChoiceRef({
      phone_digits: PHONE_A,
      order_id: "ord-a1",
      organization_id: "org-a",
    });
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    const identify = session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: null });
    db.sessions[0] = identify;
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
  });

  it("TEST 11 expired session fails", async () => {
    const db = sampleDb();
    db.sessions[0].expires_at = "2026-10-05T00:00:00.000Z";
    const result = await getBoundSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", now: NOW });
    expect(result.ok).toBe(false);
  });

  it("TEST 12–13 20-day exact boundary and +1ms", () => {
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED, now: new Date(DELIVERED.getTime() + 20 * 86_400_000) })).toBe(true);
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED, now: new Date(DELIVERED.getTime() + 20 * 86_400_000 + 1) })).toBe(false);
  });

  it("TEST 14 expired delivered order is not listed", async () => {
    const db = sampleDb();
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    const listed = await listEligibleOrders(fakeSupabase(db) as never, {
      session: session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: "org-a" }),
      now: NOW,
    });
    expect(listed.choices.some((row) => row.order_ref === "PB-A1")).toBe(false);
    expect(listed.choices.some((row) => row.order_ref === "PB-B1")).toBe(false);
  });

  it("TEST 15 expired delivered order cannot bind", async () => {
    const db = sampleDb();
    db.sessions[0] = session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: null });
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: eligibleChoiceRef({ phone_digits: PHONE_A, order_id: "ord-a1", organization_id: "org-a" }),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(db.sessions[0].selected_order_id).toBeNull();
  });

  it("TEST 16 bound expired order cannot return data", async () => {
    const db = sampleDb();
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    const result = await getBoundSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", now: NOW });
    expect(result).toMatchObject({ ok: false, code: BOUND_SUPPORT_REJECTED });
    expect(db.sessions[0].state).toBe("ORDER_BOUND");
  });

  it("TEST 17 trusted MCP + valid session succeeds", async () => {
    const result = await searchOrderDetails(
      fakeSupabase(sampleDb()) as never,
      { now: NOW },
      platformSupportMcpContext("sess-a")
    );
    expect(result.found).toBe(true);
    expect(result.results[0]?.order_number).toBe("PB-A1");
  });

  it("TEST 18–20 remote MCP with session_id, victim phone, or victim order_id fails", async () => {
    const supabase = fakeSupabase(sampleDb());
    const denied = await searchOrderDetails(supabase as never, { now: NOW });
    expect(denied.answer).toBe(MCP_UNAUTHORIZED);
    const args = parseSearchOrderDetailsArgs({
      session_id: "sess-a",
      whatsapp: "+918848772371",
      order_id: "ord-a1",
    });
    expect(args).not.toHaveProperty("sessionId");
    const handled = await handleMcpRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: SEARCH_ORDER_DETAILS_TOOL,
          arguments: { session_id: "sess-a", whatsapp: "+918848772371", order_id: "ord-c1" },
        },
      },
      (toolArgs) => searchOrderDetails(supabase as never, { ...toolArgs, now: NOW })
    );
    const body = handled.body as { result: { structuredContent: { answer: string; found: boolean } } };
    expect(body.result.structuredContent.found).toBe(false);
    expect(body.result.structuredContent.answer).toBe(MCP_UNAUTHORIZED);
  });

  it("TEST 21 knowledge base contains no customer order data", () => {
    const merchantOnly = formatMerchantOnlyKnowledgeDocument(knowledge);
    expect(merchantOnly).not.toContain("PB-A1");
    expect(merchantOnly).not.toContain("TRACK-A1");
    expect(merchantOnly).not.toContain("Customer WhatsApp");
    expect(formatKnowledgeDocument(knowledge)).toContain("PB-A1");
  });

  it("TEST 22 merchant-direct path cannot use platform assistant/session", async () => {
    const result = await handleVachatAssistantMessage(fakeSupabase(sampleDb()) as never, {
      from: `+91${PHONE_A}`,
      text: "Where is my order?",
    });
    expect(result).toMatchObject({ handled: false, reason: "platform_off" });
  });

  it("TEST 23 platform bound order does not read merchant-direct connections or public tracking", async () => {
    const db = sampleDb();
    const supabase = fakeSupabase(db);
    const result = await getBoundSupportOrder(supabase as never, { sessionId: "sess-a", now: NOW });
    expect(result.ok).toBe(true);
    expect(db.fromTables).not.toContain("vachat_connections");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("TEST 24 platform support number cannot become customer identity", () => {
    expect(() => sessionPhoneDigits("+918618456029")).toThrow(/PostBus WhatsApp line/i);
  });

  it("TEST 25 duplicate selection cannot switch bound order", async () => {
    const db = sampleDb();
    db.sessions[0] = session({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: null });
    const first = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: eligibleChoiceRef({ phone_digits: PHONE_A, order_id: "ord-a1", organization_id: "org-a" }),
      now: NOW,
    });
    expect(first.ok).toBe(true);
    const switchOrder = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: eligibleChoiceRef({ phone_digits: PHONE_A, order_id: "ord-b1", organization_id: "org-b" }),
      now: NOW,
    });
    expect(switchOrder).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(db.sessions[0].selected_order_id).toBe("ord-a1");
  });

  it("expired bound order is unavailable through trusted MCP", async () => {
    const db = sampleDb();
    db.shipments[0].delivered_at = "2026-09-15T12:00:00.000Z";
    const result = await searchOrderDetails(
      fakeSupabase(db) as never,
      { now: NOW },
      platformSupportMcpContext("sess-a")
    );
    expect(result.found).toBe(false);
    expect(result.answer).toBe(MCP_ORDER_UNAVAILABLE);
  });
});
