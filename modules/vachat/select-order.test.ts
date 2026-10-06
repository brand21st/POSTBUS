import { describe, expect, it } from "vitest";
import { eligibleChoiceRef } from "@/modules/vachat/eligible-orders";
import {
  SELECT_SUPPORT_EXPIRED,
  SELECT_SUPPORT_REJECTED,
  selectSupportOrder,
} from "@/modules/vachat/select-order";
import {
  SUPPORT_SESSION_TTL_MS,
  type WhatsappSupportSession,
} from "@/modules/vachat/support-session";

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
type Org = { id: string; name: string };

type Db = {
  customers: Customer[];
  addresses: Address[];
  orders: Order[];
  organizations: Org[];
  sessions: WhatsappSupportSession[];
  shipments: Array<Record<string, unknown>>;
  mutations: Array<{ table: string; op: string; payload?: unknown }>;
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
    expires_at: "2026-10-07T00:00:00.000Z",
    last_seen_at: "2026-10-06T00:00:00.000Z",
    created_at: "2026-10-06T00:00:00.000Z",
    updated_at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function sampleDb(): Db {
  return {
    mutations: [],
    shipments: [],
    sessions: [sessionRow(), sessionRow({ id: "sess-b", phone_digits: PHONE_B })],
    organizations: [
      { id: "org-zoura", name: "Zoura Parfums" },
      { id: "org-evlath", name: "EVLATH HOLDINGS" },
      { id: "org-aurimo", name: "AURIMO BY NISH" },
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
  };
}

function idsFromIn(expr: string, field: string) {
  const match = expr.match(new RegExp(`${field}\\.in\\.\\(([^)]*)\\)`));
  if (!match) return [] as string[];
  return match[1].split(",").filter(Boolean);
}

function fakeSupabase(db: Db) {
  const run = (table: string, filters: Record<string, unknown>) => {
    let rows: Record<string, unknown>[] =
      table === "customers"
        ? db.customers
        : table === "addresses"
          ? db.addresses
          : table === "orders"
            ? db.orders
            : table === "organizations"
              ? db.organizations
              : table === "whatsapp_support_sessions"
                ? db.sessions
                : table === "shipments"
                  ? db.shipments
                  : [];
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
    if (filters.order === "created_at") {
      const dir = (filters.ascending as boolean | undefined) === true ? 1 : -1;
      rows = [...rows].sort(
        (a, b) => dir * (Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)))
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
        return builder(table, { ...filters, eq: [column, value] });
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
    from(table: string) {
      return {
        ...builder(table),
        insert(payload: Record<string, unknown>) {
          db.mutations.push({ table, op: "insert", payload });
          return builder(table);
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              db.mutations.push({ table, op: "update", payload });
              if (table === "whatsapp_support_sessions") {
                const row = db.sessions.find((item) => String(item[column as keyof WhatsappSupportSession]) === value);
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

function refA(orderId: string, organizationId: string) {
  return eligibleChoiceRef({ phone_digits: PHONE_A, order_id: orderId, organization_id: organizationId });
}

function refB(orderId: string, organizationId: string) {
  return eligibleChoiceRef({ phone_digits: PHONE_B, order_id: orderId, organization_id: organizationId });
}

function snapshot(session: WhatsappSupportSession) {
  return {
    selected_order_id: session.selected_order_id,
    selected_organization_id: session.selected_organization_id,
    state: session.state,
    last_seen_at: session.last_seen_at,
    expires_at: session.expires_at,
  };
}

describe("selectSupportOrder", () => {
  it("binds the chosen Zoura order and organization, not the newest EVLATH order", async () => {
    const db = sampleDb();
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-z-40", "org-zoura"),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyBound).toBe(false);
    expect(result.order_id).toBe("ord-z-40");
    expect(result.organization_id).toBe("org-zoura");
    expect(result.session.state).toBe("ORDER_BOUND");
    expect(result.session.selected_order_id).toBe("ord-z-40");
    expect(result.session.selected_organization_id).toBe("org-zoura");
    expect(result.session.last_seen_at).toBe(NOW.toISOString());
    expect(Date.parse(result.session.expires_at) - NOW.getTime()).toBe(SUPPORT_SESSION_TTL_MS);
    expect(db.sessions[0].selected_order_id).toBe("ord-z-40");
  });

  it("can bind Merchant B (EVLATH) for the same customer", async () => {
    const db = sampleDb();
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-e-47", "org-evlath"),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.selected_order_id).toBe("ord-e-47");
    expect(result.session.selected_organization_id).toBe("org-evlath");
  });

  it("rejects tampered, truncated, and invalid HMAC refs without mutating the session", async () => {
    const db = sampleDb();
    const valid = refA("ord-z-48", "org-zoura");
    const before = snapshot(db.sessions[0]);
    const cases = [
      valid.slice(0, -2) + "aa",
      valid.slice(1),
      `${valid}x`,
      "not-a-ref",
      "",
    ];
    for (const choiceRef of cases) {
      const result = await selectSupportOrder(fakeSupabase(db) as never, {
        sessionId: "sess-a",
        choiceRef,
        now: NOW,
      });
      expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    }
    expect(snapshot(db.sessions[0])).toEqual(before);
    expect(db.mutations.filter((row) => row.table === "whatsapp_support_sessions")).toEqual([]);
  });

  it("rejects another customer's choice_ref on this session and this customer's ref on another session", async () => {
    const db = sampleDb();
    const beforeA = snapshot(db.sessions[0]);
    const beforeB = snapshot(db.sessions[1]);
    await expect(
      selectSupportOrder(fakeSupabase(db) as never, {
        sessionId: "sess-a",
        choiceRef: refB("ord-b-99", "org-zoura"),
        now: NOW,
      })
    ).resolves.toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    await expect(
      selectSupportOrder(fakeSupabase(db) as never, {
        sessionId: "sess-b",
        choiceRef: refA("ord-z-48", "org-zoura"),
        now: NOW,
      })
    ).resolves.toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(snapshot(db.sessions[0])).toEqual(beforeA);
    expect(snapshot(db.sessions[1])).toEqual(beforeB);
  });

  it("rejects expired and missing sessions without writes", async () => {
    const db = sampleDb();
    db.sessions[0].expires_at = "2026-10-05T00:00:00.000Z";
    const expired = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-z-48", "org-zoura"),
      now: NOW,
    });
    expect(expired).toMatchObject({ ok: false, code: SELECT_SUPPORT_EXPIRED });
    const missing = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "missing",
      choiceRef: refA("ord-z-48", "org-zoura"),
      now: NOW,
    });
    expect(missing).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(db.mutations.filter((row) => row.table === "whatsapp_support_sessions")).toEqual([]);
  });

  it("rejects cancelled, nonexistent, other-org, and other-customer orders", async () => {
    const db = sampleDb();
    const before = snapshot(db.sessions[0]);
    const refs = [
      refA("ord-z-cancel", "org-zoura"),
      refA("ord-missing", "org-zoura"),
      refA("ord-z-48", "org-evlath"),
      refA("ord-b-99", "org-zoura"),
    ];
    for (const choiceRef of refs) {
      await expect(
        selectSupportOrder(fakeSupabase(db) as never, { sessionId: "sess-a", choiceRef, now: NOW })
      ).resolves.toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    }
    expect(snapshot(db.sessions[0])).toEqual(before);
  });

  it("rejects a stale choice_ref after the order is cancelled", async () => {
    const db = sampleDb();
    const choiceRef = refA("ord-z-48", "org-zoura");
    db.orders[0].status = "CANCELLED";
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(db.sessions[0].selected_order_id).toBeNull();
    expect(db.sessions[0].state).toBe("IDENTIFY");
  });

  it("rejects a valid choice_ref after the 20-day delivery window closes", async () => {
    const db = sampleDb();
    const choiceRef = refA("ord-z-48", "org-zoura");
    db.shipments.push({
      order_id: "ord-z-48",
      organization_id: "org-zoura",
      delivered_at: "2026-09-15T12:00:00.000Z",
      updated_at: "2026-09-15T12:00:00.000Z",
    });
    const before = snapshot(db.sessions[0]);
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(result).toMatchObject({ message: "That order is not available for WhatsApp support." });
    expect(snapshot(db.sessions[0])).toEqual(before);
  });

  it("rejects the PostBus business WhatsApp as a session identity", async () => {
    const db = sampleDb();
    db.sessions[0].phone_digits = "8618456029";
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: eligibleChoiceRef({
        phone_digits: "8618456029",
        order_id: "ord-z-48",
        organization_id: "org-zoura",
      }),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(db.sessions[0].selected_order_id).toBeNull();
  });

  it("ignores attacker-supplied order/org/merchant/whatsapp fields", async () => {
    const db = sampleDb();
    const result = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-z-48", "org-zoura"),
      now: NOW,
      order_id: "ord-b-99",
      organization_id: "org-evlath",
      merchant_id: "attacker-merchant",
      customer_id: "cust-b-z",
      whatsapp: "+919998887776",
      phone: "+919998887776",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order_id).toBe("ord-z-48");
    expect(result.organization_id).toBe("org-zoura");
    expect(result.session.selected_order_id).toBe("ord-z-48");
    expect(result.session.selected_organization_id).toBe("org-zoura");
  });

  it("is idempotent for the same bound choice and rejects switching orders", async () => {
    const db = sampleDb();
    const first = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-z-48", "org-zoura"),
      now: NOW,
    });
    expect(first.ok).toBe(true);
    db.mutations = [];
    const seen = db.sessions[0].last_seen_at;
    const again = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-z-48", "org-zoura"),
      now: new Date("2026-10-06T18:00:00.000Z"),
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.alreadyBound).toBe(true);
    expect(db.sessions[0].last_seen_at).toBe(seen);
    expect(db.mutations.filter((row) => row.table === "whatsapp_support_sessions")).toEqual([]);

    const switchOrder = await selectSupportOrder(fakeSupabase(db) as never, {
      sessionId: "sess-a",
      choiceRef: refA("ord-e-47", "org-evlath"),
      now: NOW,
    });
    expect(switchOrder).toMatchObject({ ok: false, code: SELECT_SUPPORT_REJECTED });
    expect(db.sessions[0].selected_order_id).toBe("ord-z-48");
    expect(db.sessions[0].selected_organization_id).toBe("org-zoura");
    expect(db.sessions[0].state).toBe("ORDER_BOUND");
  });
});
