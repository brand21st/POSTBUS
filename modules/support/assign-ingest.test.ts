import { describe, expect, it, vi } from "vitest";
import { ingestAssignedUnassignedThread } from "@/modules/support/assign-ingest";

vi.mock("@/modules/support/tickets", () => ({
  attachOrCreateTicket: async () => ({ ticket: { id: "tkt-1" } }),
}));

vi.mock("@/modules/support/conversations", () => ({
  ensureSupportChannel: async () => "ch-1",
  upsertConversation: async () => ({
    id: "conv-1",
    unread_count: 0,
    last_message_preview: null,
    last_message_at: null,
  }),
}));

describe("ingestAssignedUnassignedThread", () => {
  it("copies queued messages in order and skips duplicates", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table === "support_unassigned_messages") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return Promise.resolve({
                data: [
                  { id: "m1", provider_message_id: "wa-1", body: "first", content_type: "text", created_at: "2026-10-01T10:00:00.000Z" },
                  { id: "m2", provider_message_id: "wa-1", body: "dup", content_type: "text", created_at: "2026-10-01T10:01:00.000Z" },
                  { id: "m3", provider_message_id: "wa-3", body: "second", content_type: "text", created_at: "2026-10-01T10:02:00.000Z" },
                ],
                error: null,
              });
            },
          };
        }
        if (table === "support_messages") {
          return {
            insert(row: Record<string, unknown>) {
              if (inserted.some((item) => item.provider_message_id === row.provider_message_id)) {
                return {
                  select() {
                    return {
                      maybeSingle: async () => ({ data: null, error: { code: "23505" } }),
                    };
                  },
                };
              }
              inserted.push(row);
              return {
                select() {
                  return {
                    maybeSingle: async () => ({ data: { id: `msg-${inserted.length}` }, error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === "support_conversations" || table === "notifications") {
          return {
            update() {
              return { eq() { return { eq() { return Promise.resolve({ error: null }); } }; } };
            },
            insert() {
              return Promise.resolve({ error: null });
            },
          };
        }
        return {
          insert() {
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const result = await ingestAssignedUnassignedThread(supabase as never, {
      organizationId: "org-a",
      orderId: "ord-a",
      phoneDigits: "9876543210",
      threadId: "th-1",
    });
    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(1);
    expect(inserted.map((row) => row.body)).toEqual(["first", "second"]);
    expect(inserted[0].created_at).toBe("2026-10-01T10:00:00.000Z");
    expect(inserted[0].organization_id).toBe("org-a");
    expect(inserted[0].conversation_id).toBe("conv-1");
  });
});
