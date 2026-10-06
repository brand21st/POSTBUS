import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  SUPPORT_SESSION_TTL_MS,
  getOrCreateSupportSession,
  getSupportSessionById,
  getSupportSessionByPhone,
  isSupportSessionExpired,
  sessionPhoneDigits,
  touchExpiry,
  type WhatsappSupportSession,
} from "@/modules/vachat/support-session";

type Row = WhatsappSupportSession;

function row(overrides: Partial<Row> = {}): Row {
  const now = new Date("2026-10-06T00:00:00.000Z");
  const touch = touchExpiry(now);
  return {
    id: "sess-1",
    source: "platform",
    phone_digits: "8848772371",
    selected_order_id: "order-1",
    selected_organization_id: "org-1",
    state: "ORDER_BOUND",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...touch,
    ...overrides,
  };
}

function fakeSupabase(store: Map<string, Row>) {
  return {
    from() {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              return {
                async maybeSingle() {
                  const found = [...store.values()].find((item) =>
                    column === "id" ? item.id === value : item.phone_digits === value
                  );
                  return { data: found ?? null, error: null };
                },
                async single() {
                  const found = [...store.values()].find((item) =>
                    column === "id" ? item.id === value : item.phone_digits === value
                  );
                  return { data: found ?? null, error: found ? null : { message: "missing" } };
                },
              };
            },
          };
        },
        insert(payload: Partial<Row>) {
          const created = row({
            id: `sess-${store.size + 1}`,
            selected_order_id: null,
            selected_organization_id: null,
            state: "IDENTIFY",
            ...payload,
            phone_digits: String(payload.phone_digits),
          });
          store.set(created.id, created);
          return {
            select() {
              return {
                async single() {
                  return { data: created, error: null };
                },
              };
            },
          };
        },
        update(payload: Partial<Row>) {
          return {
            eq(_column: string, id: string) {
              const current = store.get(id);
              if (!current) {
                return {
                  select() {
                    return {
                      async single() {
                        return { data: null, error: { message: "missing" } };
                      },
                    };
                  },
                };
              }
              const next = { ...current, ...payload, id: current.id, phone_digits: current.phone_digits };
              store.set(id, next);
              return {
                select() {
                  return {
                    async single() {
                      return { data: next, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("sessionPhoneDigits", () => {
  it("normalizes +91, 91, leading 0, and 10-digit Indian numbers", () => {
    expect(sessionPhoneDigits("+918848772371")).toBe("8848772371");
    expect(sessionPhoneDigits("918848772371")).toBe("8848772371");
    expect(sessionPhoneDigits("08848772371")).toBe("8848772371");
    expect(sessionPhoneDigits("8848772371")).toBe("8848772371");
  });

  it("rejects invalid numbers", () => {
    expect(() => sessionPhoneDigits("5848772371")).toThrow(AppError);
    expect(() => sessionPhoneDigits("884877237")).toThrow(AppError);
    expect(() => sessionPhoneDigits("")).toThrow(AppError);
  });

  it("rejects the PostBus business WhatsApp line", () => {
    expect(() => sessionPhoneDigits("+918618456029")).toThrow(/PostBus WhatsApp line/i);
    expect(() => sessionPhoneDigits("8618456029")).toThrow(/PostBus WhatsApp line/i);
  });
});

describe("expiry helpers", () => {
  it("treats past expires_at and EXPIRED state as expired", () => {
    const now = new Date("2026-10-07T00:00:00.000Z");
    expect(isSupportSessionExpired(row({ expires_at: "2026-10-06T00:00:00.000Z" }), now)).toBe(true);
    expect(isSupportSessionExpired(row({ state: "EXPIRED", expires_at: "2026-10-08T00:00:00.000Z" }), now)).toBe(
      true
    );
    expect(isSupportSessionExpired(row({ expires_at: "2026-10-08T00:00:00.000Z" }), now)).toBe(false);
  });

  it("extends last_seen_at by 24 hours", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const touch = touchExpiry(now);
    expect(touch.last_seen_at).toBe(now.toISOString());
    expect(Date.parse(touch.expires_at) - now.getTime()).toBe(SUPPORT_SESSION_TTL_MS);
  });
});

describe("getOrCreateSupportSession", () => {
  it("creates then returns the same session for the same phone", async () => {
    const store = new Map<string, Row>();
    const supabase = fakeSupabase(store) as never;
    const created = await getOrCreateSupportSession(supabase, "+91 88487 72371", new Date("2026-10-06T00:00:00.000Z"));
    expect(created.phone_digits).toBe("8848772371");
    expect(created.state).toBe("IDENTIFY");
    expect(created.selected_order_id).toBeNull();
    const again = await getOrCreateSupportSession(supabase, "8848772371", new Date("2026-10-06T01:00:00.000Z"));
    expect(again.id).toBe(created.id);
    expect(again.last_seen_at).toBe("2026-10-06T01:00:00.000Z");
  });

  it("resets an expired session to IDENTIFY and clears the selected order", async () => {
    const existing = row({
      expires_at: "2026-10-05T00:00:00.000Z",
      last_seen_at: "2026-10-04T00:00:00.000Z",
    });
    const store = new Map<string, Row>([[existing.id, existing]]);
    const supabase = fakeSupabase(store) as never;
    const next = await getOrCreateSupportSession(supabase, "8848772371", new Date("2026-10-06T00:00:00.000Z"));
    expect(next.id).toBe(existing.id);
    expect(next.state).toBe("IDENTIFY");
    expect(next.selected_order_id).toBeNull();
    expect(next.selected_organization_id).toBeNull();
    expect(next.expires_at).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("getSupportSession lookups", () => {
  it("loads by phone and by id", async () => {
    const existing = row({ state: "IDENTIFY", selected_order_id: null, selected_organization_id: null });
    const store = new Map<string, Row>([[existing.id, existing]]);
    const supabase = fakeSupabase(store) as never;
    await expect(getSupportSessionByPhone(supabase, "918848772371")).resolves.toMatchObject({
      id: "sess-1",
      phone_digits: "8848772371",
    });
    await expect(getSupportSessionById(supabase, "sess-1")).resolves.toMatchObject({ id: "sess-1" });
  });

  it("throws when the session id is missing", async () => {
    const supabase = fakeSupabase(new Map()) as never;
    await expect(getSupportSessionById(supabase, "missing")).rejects.toBeInstanceOf(AppError);
  });
});
