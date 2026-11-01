import { describe, expect, it } from "vitest";
import {
  assignTicketSchema,
  conversationListQuery,
  createTicketSchema,
  patchTicketSchema,
  sendMessageSchema,
  ticketListQuery,
  ticketNoteSchema,
} from "@/modules/support/schema";

describe("Support Center input validation", () => {
  it("rejects invalid ticket and conversation identifiers", () => {
    expect(() => createTicketSchema.parse({ conversationId: "not-a-uuid" })).toThrow();
    expect(() => assignTicketSchema.parse({ assignedTo: "nope" })).toThrow();
    expect(() => ticketListQuery.parse({ conversationId: "abc" })).toThrow();
  });

  it("rejects missing required fields and oversized payloads", () => {
    expect(() => createTicketSchema.parse({})).toThrow();
    expect(() => sendMessageSchema.parse({ clientSendId: "not-uuid", text: "hi" })).toThrow();
    expect(() => sendMessageSchema.parse({ clientSendId: crypto.randomUUID(), text: "" })).toThrow();
    expect(() => ticketNoteSchema.parse({ body: "x".repeat(4001) })).toThrow();
  });

  it("rejects unsupported filters and pagination", () => {
    expect(() => ticketListQuery.parse({ status: "not-a-status" })).toThrow();
    expect(() => ticketListQuery.parse({ limit: 0 })).toThrow();
    expect(() => ticketListQuery.parse({ limit: 101 })).toThrow();
    expect(() => conversationListQuery.parse({ filter: "secret" })).toThrow();
    expect(ticketListQuery.parse({ limit: "20" })).toMatchObject({ limit: 20 });
  });

  it("rejects invalid ticket mutations", () => {
    expect(() => patchTicketSchema.parse({ status: "done" })).toThrow();
    expect(() => patchTicketSchema.parse({ orderId: "bad" })).toThrow();
  });
});
