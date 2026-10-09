import { describe, expect, it } from "vitest";
import { listConversations } from "@/modules/support/conversations";

function chain(result: { data?: unknown; error?: unknown } = { data: [] }) {
  const filters: Record<string, unknown> = {};
  const self: Record<string, unknown> = {};
  const next = () => self;
  self.select = next;
  self.eq = (column: string, value: string) => {
    filters.eq = [column, value];
    return self;
  };
  self.or = (expr: string) => {
    filters.or = expr;
    return self;
  };
  self.ilike = (column: string, value: string) => {
    filters.ilike = [column, value];
    return self;
  };
  self.in = next;
  self.gt = next;
  self.lt = next;
  self.order = next;
  self.limit = next;
  self.then = (resolve: (value: unknown) => unknown) => resolve(result);
  Object.defineProperty(self, "filters", { get: () => filters });
  return self;
}

describe("listConversations search", () => {
  it("scopes search to the merchant organization and supported fields", async () => {
    const seen: string[] = [];
    const supabase = {
      from(table: string) {
        seen.push(table);
        if (table === "support_conversations") {
          const self = chain({
            data: [
              {
                id: "conv-a",
                organization_id: "org-a",
                channel_id: "ch-1",
                phone_digits: "9876543210",
                customer_name: "Rahul",
                last_message_preview: "hi",
                last_message_at: "2026-10-09T00:00:00.000Z",
                unread_count: 0,
                service_window_expires_at: null,
              },
            ],
          });
          return self;
        }
        if (table === "support_tickets") {
          return chain({ data: [{ conversation_id: "conv-a", public_number: "PB-TKT-2026-000001" }] });
        }
        if (table === "orders") {
          return chain({ data: [] });
        }
        if (table === "support_channels") {
          return chain({ data: [{ id: "ch-1", kind: "postbus_global" }] });
        }
        return chain({ data: [] });
      },
    };
    const result = await listConversations(supabase as never, "org-a", { q: "Rahul" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("conv-a");
    expect(seen.includes("support_tickets")).toBe(true);
  });

  it("returns an empty list when nothing matches", async () => {
    const supabase = {
      from() {
        return chain({ data: [] });
      },
    };
    const result = await listConversations(supabase as never, "org-a", { q: "missing" });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
