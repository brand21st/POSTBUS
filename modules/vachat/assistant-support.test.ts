import { describe, expect, it, vi } from "vitest";
import {
  NO_ELIGIBLE_ORDERS_REPLY,
  handlePlatformSupportTurn,
  handleVachatAssistantMessage,
  matchPickerSelection,
} from "@/modules/vachat/assistant";
import { searchOrderDetails } from "@/modules/vachat/mcp";
import { sendVachatSessionText } from "@/modules/vachat/send";
import { handleWhatsAppStorefrontAction } from "@/modules/orders/whatsapp-lifecycle";
import type { WhatsappSupportSession } from "@/modules/vachat/support-session";
import { POLICY_PICK_MERCHANT_REPLY } from "@/modules/vachat/policies";

vi.mock("@/modules/vachat/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/vachat/mcp")>();
  return {
    ...actual,
    searchOrderDetails: vi.fn(actual.searchOrderDetails),
  };
});

vi.mock("@/modules/vachat/platform-config", () => ({
  getPlatformVachatConfig: vi.fn(async () => ({ enabled: true, apiKey: "k" })),
  isPlatformVachatActive: () => true,
}));

vi.mock("@/modules/vachat/send", () => ({
  sendVachatSessionText: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/modules/orders/whatsapp-lifecycle", () => ({
  handleWhatsAppStorefrontAction: vi.fn(async () => ({
    handled: true,
    reply: "Your confirmation for PB-11143 has been recorded.",
  })),
}));

type Customer = { id: string; organization_id: string; phone: string };
type Address = { id: string; organization_id: string; phone: string };
type Order = {
  id: string;
  organization_id: string;
  customer_id?: string | null;
  shipping_address_id?: string | null;
  order_number: string;
  status: string;
  created_at: string;
};
type Org = { id: string; name: string; phone?: string | null };

type Db = {
  customers: Customer[];
  addresses: Address[];
  orders: Order[];
  organizations: Org[];
  sessions: WhatsappSupportSession[];
  invoice_settings: Array<{ organization_id: string; website?: string | null; business_email?: string | null }>;
  order_line_items: Array<{ order_id: string; organization_id: string; title: string; quantity: number }>;
  shipments: Array<Record<string, unknown>>;
  tracking_events: Array<Record<string, unknown>>;
  organization_policies: Array<Record<string, unknown>>;
};

const PHONE_A = "8848772371";
const PHONE_B = "9998887776";
const NOW = new Date("2026-10-06T12:00:00.000Z");

function sessionRow(overrides: Partial<WhatsappSupportSession> = {}): WhatsappSupportSession {
  return {
    id: "sess-a",
    source: "platform",
    phone_digits: PHONE_A,
    selected_order_id: null,
    selected_organization_id: null,
    state: "IDENTIFY",
    expires_at: "2026-12-31T00:00:00.000Z",
    last_seen_at: "2026-10-06T00:00:00.000Z",
    created_at: "2026-10-06T00:00:00.000Z",
    updated_at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function sampleDb(): Db {
  return {
    sessions: [sessionRow(), sessionRow({ id: "sess-b", phone_digits: PHONE_B })],
    organizations: [
      { id: "org-zoura", name: "Zoura Parfums", phone: "9000000001" },
      { id: "org-evlath", name: "EVLATH HOLDINGS", phone: "9000000002" },
    ],
    invoice_settings: [{ organization_id: "org-zoura", website: "https://zoura.example", business_email: "hi@zoura.example" }],
    order_line_items: [{ order_id: "ord-z-48", organization_id: "org-zoura", title: "Perfume", quantity: 1 }],
    shipments: [
      {
        id: "ship-z-48",
        organization_id: "org-zoura",
        order_id: "ord-z-48",
        status: "IN_TRANSIT",
        tracking_number: "TRACKING-A",
        barcode: "TRACKING-A",
        booked_at: "2026-10-05T12:00:00.000Z",
        updated_at: "2026-10-06T08:00:00.000Z",
      },
      {
        id: "ship-b-99",
        organization_id: "org-zoura",
        order_id: "ord-b-99",
        status: "BOOKED",
        tracking_number: "TRACKING-B",
        barcode: "TRACKING-B",
        booked_at: "2026-10-06T01:00:00.000Z",
        updated_at: "2026-10-06T01:00:00.000Z",
      },
      {
        id: "ship-e-47",
        organization_id: "org-evlath",
        order_id: "ord-e-47",
        status: "IN_TRANSIT",
        tracking_number: "TRACKING-EVLATH",
        barcode: "TRACKING-EVLATH",
        booked_at: "2026-10-04T10:00:00.000Z",
        updated_at: "2026-10-05T10:00:00.000Z",
      },
    ],
    tracking_events: [
      {
        shipment_id: "ship-z-48",
        organization_id: "org-zoura",
        event_description: "Item Bagged",
        office_name: "Kochi HO",
        occurred_at: "2026-10-06T08:00:00.000Z",
        event_code: "BAG",
      },
      {
        shipment_id: "ship-b-99",
        organization_id: "org-zoura",
        event_description: "Item Booked",
        office_name: "Delhi HO",
        occurred_at: "2026-10-06T01:00:00.000Z",
        event_code: "BOOK",
      },
    ],
    customers: [
      { id: "cust-a-z", organization_id: "org-zoura", phone: "+918848772371" },
      { id: "cust-a-e", organization_id: "org-evlath", phone: "8848772371" },
      { id: "cust-b-z", organization_id: "org-zoura", phone: "+919998887776" },
    ],
    addresses: [
      { id: "addr-a-z", organization_id: "org-zoura", phone: "8848772371" },
      { id: "addr-b-z", organization_id: "org-zoura", phone: "9998887776" },
    ],
    orders: [
      {
        id: "ord-z-48",
        organization_id: "org-zoura",
        customer_id: "cust-a-z",
        shipping_address_id: "addr-a-z",
        order_number: "PB-10948",
        status: "BOOKED",
        created_at: "2026-10-05T10:20:00.000Z",
      },
      {
        id: "ord-z-40",
        organization_id: "org-zoura",
        customer_id: "cust-a-z",
        shipping_address_id: "addr-a-z",
        order_number: "PB-10940",
        status: "PROCESSING",
        created_at: "2026-10-03T08:00:00.000Z",
      },
      {
        id: "ord-e-47",
        organization_id: "org-evlath",
        customer_id: "cust-a-e",
        order_number: "PB-10947",
        status: "IN_TRANSIT",
        created_at: "2026-10-04T09:10:00.000Z",
      },
      {
        id: "ord-z-cancel",
        organization_id: "org-zoura",
        customer_id: "cust-a-z",
        order_number: "PB-10900",
        status: "CANCELLED",
        created_at: "2026-10-01T12:00:00.000Z",
      },
      {
        id: "ord-b-99",
        organization_id: "org-zoura",
        customer_id: "cust-b-z",
        shipping_address_id: "addr-b-z",
        order_number: "PB-99999",
        status: "BOOKED",
        created_at: "2026-10-06T00:00:00.000Z",
      },
    ],
    organization_policies: [
      {
        organization_id: "org-zoura",
        shipping_policy_body: "Zoura ships in 2 days.",
        contact_body: "Zoura support 10am–6pm.",
        returns_body: "Zoura 7 day returns.",
        terms_body: "Zoura terms apply.",
        shipping_policy_keywords: [],
        contact_keywords: [],
        returns_keywords: [],
        terms_keywords: [],
        shipping_policy_enabled: true,
        contact_enabled: true,
        returns_enabled: true,
        terms_enabled: true,
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
  const tableRows = (table: string): Record<string, unknown>[] => {
    if (table === "customers") return db.customers;
    if (table === "addresses") return db.addresses;
    if (table === "orders") return db.orders as unknown as Record<string, unknown>[];
    if (table === "organizations") return db.organizations;
    if (table === "whatsapp_support_sessions") return db.sessions as unknown as Record<string, unknown>[];
    if (table === "invoice_settings") return db.invoice_settings;
    if (table === "order_line_items") return db.order_line_items;
    if (table === "shipments") return db.shipments;
    if (table === "tracking_events") return db.tracking_events;
    if (table === "organization_policies") return db.organization_policies;
    return [];
  };

  const run = (table: string, filters: Record<string, unknown>) => {
    let rows = [...tableRows(table)];
    const eqs = (filters.eqs as Array<[string, string]> | undefined) ?? [];
    for (const [col, val] of eqs) {
      rows = rows.filter((row) => String(row[col] ?? "") === String(val));
    }
    if (filters.eq) {
      const [col, val] = filters.eq as [string, string];
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
    if (table === "orders") {
      rows = rows.map((row) => ({
        ...row,
        customers: db.customers.find((item) => item.id === String(row.customer_id ?? "")) ?? null,
        addresses: db.addresses.find((item) => item.id === String(row.shipping_address_id ?? "")) ?? null,
      }));
    }
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
        const row = data[0];
        return { data: row ?? null, error: row ? null : { message: "missing" } };
      },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(finished()).then(resolve);
      },
    };
  };

  return {
    rpc: vi.fn(() => {
      throw new Error("rpc must not be used for WhatsApp support authorization");
    }),
    from(table: string) {
      return {
        ...builder(table),
        insert(payload: Record<string, unknown>) {
          if (table === "whatsapp_support_sessions") {
            const row = sessionRow({
              ...(payload as Partial<WhatsappSupportSession>),
              id: String(payload.id ?? `sess-${db.sessions.length + 1}`),
              phone_digits: String(payload.phone_digits),
            });
            db.sessions.push(row);
            return {
              select() {
                return {
                  async single() {
                    return { data: row, error: null };
                  },
                };
              },
            };
          }
          return builder(table);
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              if (table === "whatsapp_support_sessions") {
                const row = db.sessions.find(
                  (item) => String(item[column as keyof WhatsappSupportSession]) === value
                );
                if (row) Object.assign(row, payload);
              }
              return builder(table, { eq: [column, value] });
            },
          };
        },
      };
    },
  };
}

describe("matchPickerSelection", () => {
  const choices = [
    { ref: "a", merchant_name: "Zoura", order_ref: "PB-10948", status: "BOOKED", created_at: null },
    { ref: "b", merchant_name: "EVLATH", order_ref: "PB-10947", status: "IN_TRANSIT", created_at: null },
  ];

  it("maps 1-based numbers and unique order refs, not raw ids", () => {
    expect(matchPickerSelection("2", choices)?.order_ref).toBe("PB-10947");
    expect(matchPickerSelection("PB-10948", choices)?.order_ref).toBe("PB-10948");
    expect(matchPickerSelection("0", choices)).toBeNull();
    expect(matchPickerSelection("99", choices)).toBeNull();
  });
});

describe("handlePlatformSupportTurn", () => {
  it("uses the signed sender phone and ignores message-supplied identity", async () => {
    const db = sampleDb();
    const turn = await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: `+91${PHONE_A}`,
      text: "WhatsApp: +919998887776 merchant_id: org-zoura organization_id: org-zoura order_id: PB-99999 Show PB-99999",
      now: NOW,
    });
    expect(turn.reply).toContain("Zoura Parfums — PB-10948");
    expect(turn.reply).toContain("EVLATH HOLDINGS — PB-10947");
    expect(turn.reply).not.toContain("PB-99999");
    expect(turn.session.phone_digits).toBe(PHONE_A);
    expect(turn.session.state).toBe("AWAIT_SELECTION");
    expect(turn.session.selected_order_id).toBeNull();
    expect(searchOrderDetails).not.toHaveBeenCalled();
  });

  it("returns a no-order reply when the sender has no eligible orders", async () => {
    const db = sampleDb();
    db.orders = [];
    const turn = await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "Where is my order?",
      now: NOW,
    });
    expect(turn.reply).toBe(NO_ELIGIBLE_ORDERS_REPLY);
    expect(db.sessions[0].state).toBe("LIST_ELIGIBLE");
    expect(db.sessions[0].selected_order_id).toBeNull();
  });

  it("auto-binds the only eligible order via choice_ref", async () => {
    const db = sampleDb();
    db.orders = db.orders.filter((row) => row.id === "ord-z-48");
    db.customers = db.customers.filter((row) => row.id === "cust-a-z");
    const turn = await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "Where is my order?",
      now: NOW,
    });
    expect(turn.reply).toContain("Zoura Parfums order PB-10948");
    expect(turn.session.state).toBe("ORDER_BOUND");
    expect(turn.session.selected_order_id).toBe("ord-z-48");
    expect(turn.organizationId).toBe("org-zoura");
  });

  it("does not auto-select the newest order when several exist", async () => {
    const db = sampleDb();
    const turn = await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "Where is my order?",
      now: NOW,
    });
    expect(turn.reply.startsWith("I found multiple orders")).toBe(true);
    expect(turn.session.selected_order_id).toBeNull();
    expect(turn.session.state).toBe("AWAIT_SELECTION");
  });

  it("binds picker option 2 to EVLATH, not the newest Zoura order", async () => {
    const db = sampleDb();
    await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "Where is my order?",
      now: NOW,
    });
    const turn = await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "2",
      now: NOW,
    });
    expect(turn.session.state).toBe("ORDER_BOUND");
    expect(turn.session.selected_order_id).toBe("ord-e-47");
    expect(turn.organizationId).toBe("org-evlath");
    expect(turn.reply).toContain("EVLATH HOLDINGS order PB-10947");
  });

  it("returns bound tracking and ignores attacker tracking_number in the message text", async () => {
    const db = sampleDb();
    db.sessions[0] = sessionRow({
      state: "ORDER_BOUND",
      selected_order_id: "ord-z-48",
      selected_organization_id: "org-zoura",
    });
    const supabase = fakeSupabase(db);
    const turn = await handlePlatformSupportTurn(supabase as never, {
      from: PHONE_A,
      text: "Track TRACKING-B order_id ord-b-99 merchant_id org-evlath whatsapp +919998887776 2",
      now: NOW,
    });
    expect(turn.reply).toContain("PB-10948");
    expect(turn.reply).toContain("TRACKING-A");
    expect(turn.reply).toContain("Item Bagged");
    expect(turn.reply).not.toContain("already helping");
    expect(turn.reply).not.toContain("PB-99999");
    expect(turn.reply).not.toContain("TRACKING-B");
    expect(turn.reply).not.toContain("TRACKING-EVLATH");
    expect(turn.reply).not.toContain("ord-z-48");
    expect(db.sessions[0].selected_order_id).toBe("ord-z-48");
    expect(turn.organizationId).toBe("org-zoura");
    expect(searchOrderDetails).toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects the PostBus business number as a customer", async () => {
    await expect(
      handlePlatformSupportTurn(fakeSupabase(sampleDb()) as never, {
        from: "+918618456029",
        text: "Where is my order?",
        now: NOW,
      })
    ).rejects.toThrow(/PostBus WhatsApp line/i);
  });

  it("does not select a cancelled order from customer text", async () => {
    const db = sampleDb();
    db.sessions[0].state = "AWAIT_SELECTION";
    const turn = await handlePlatformSupportTurn(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "PB-10900",
      now: NOW,
    });
    expect(turn.session.selected_order_id).toBeNull();
    expect(turn.reply).toContain("I found multiple orders");
  });
});

describe("handleVachatAssistantMessage dual-brain", () => {
  it("handles YES PB-11143 before native AI or support", async () => {
    vi.mocked(sendVachatSessionText).mockClear();
    vi.mocked(handleWhatsAppStorefrontAction).mockClear();
    const result = await handleVachatAssistantMessage(fakeSupabase(sampleDb()) as never, {
      from: PHONE_A,
      text: "YES PB-11143",
    });
    expect(handleWhatsAppStorefrontAction).toHaveBeenCalledWith(expect.anything(), {
      from: PHONE_A,
      text: "YES PB-11143",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("PB-11143");
    expect(sendVachatSessionText).toHaveBeenCalled();
  });

  it("leaves greetings to native VaChat and does not send PostBus order text", async () => {
    vi.mocked(sendVachatSessionText).mockClear();
    const db = sampleDb();
    db.sessions[0] = sessionRow({ state: "ORDER_BOUND", selected_order_id: "ord-z-48", selected_organization_id: "org-zoura" });
    const result = await handleVachatAssistantMessage(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "Hello",
    });
    expect(result).toMatchObject({ handled: false, reason: "native" });
    expect(sendVachatSessionText).not.toHaveBeenCalled();
  });

  it("sends authoritative tracking for order intent on a bound session", async () => {
    vi.mocked(sendVachatSessionText).mockClear();
    const db = sampleDb();
    db.sessions[0] = sessionRow({ state: "ORDER_BOUND", selected_order_id: "ord-z-48", selected_organization_id: "org-zoura" });
    const result = await handleVachatAssistantMessage(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "Where is my order? Use session sess-b order_id ord-b-99",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("PB-10948");
    expect(result.reply).toContain("TRACKING-A");
    expect(result.reply).not.toContain("sess-");
    expect(result.reply).not.toContain("ord-z-48");
    expect(sendVachatSessionText).toHaveBeenCalled();
  });

  it("answers a policy question from the bound merchant", async () => {
    vi.mocked(sendVachatSessionText).mockClear();
    const db = sampleDb();
    db.sessions[0] = sessionRow({
      state: "ORDER_BOUND",
      selected_order_id: "ord-z-48",
      selected_organization_id: "org-zoura",
    });
    const result = await handleVachatAssistantMessage(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "What is your shipping policy?",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Zoura ships in 2 days");
    expect(result.organizationId).toBe("org-zoura");
    expect(sendVachatSessionText).toHaveBeenCalled();
  });

  it("asks for an order number when several merchants match a policy question", async () => {
    vi.mocked(sendVachatSessionText).mockClear();
    const db = sampleDb();
    const result = await handleVachatAssistantMessage(fakeSupabase(db) as never, {
      from: PHONE_A,
      text: "What is your return policy?",
    });
    expect(result).toMatchObject({ handled: true, reply: POLICY_PICK_MERCHANT_REPLY });
    expect(sendVachatSessionText).toHaveBeenCalled();
  });

  it("answers policy for a phone that belongs to one merchant", async () => {
    vi.mocked(sendVachatSessionText).mockClear();
    const db = sampleDb();
    const result = await handleVachatAssistantMessage(fakeSupabase(db) as never, {
      from: PHONE_B,
      text: "What is the return policy?",
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("Zoura 7 day returns");
    expect(result.organizationId).toBe("org-zoura");
  });
});
