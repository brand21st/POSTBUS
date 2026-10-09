import { describe, expect, it } from "vitest";
import {
  assertTicketTransition,
  canApprovePostbusCancellation,
  canTransitionCancellation,
  canTransitionExchange,
  canTransitionReturn,
  shouldApplyMessageStatus,
} from "@/modules/support/states";

describe("ticket transitions", () => {
  it("allows open to in_progress and blocks open to closed", () => {
    expect(() => assertTicketTransition("open", "in_progress")).not.toThrow();
    expect(() => assertTicketTransition("open", "closed")).toThrow(/Cannot change ticket status/);
  });

  it("requires resolved before closed", () => {
    expect(() => assertTicketTransition("in_progress", "resolved")).not.toThrow();
    expect(() => assertTicketTransition("resolved", "closed")).not.toThrow();
    expect(() => assertTicketTransition("open", "resolved")).toThrow();
  });

  it("reopens from resolved or closed", () => {
    expect(() => assertTicketTransition("resolved", "reopened")).not.toThrow();
    expect(() => assertTicketTransition("closed", "reopened")).not.toThrow();
  });
});

describe("request workflows", () => {
  it("moves cancellation from requested to under_review then approve", () => {
    expect(canTransitionCancellation("requested", "under_review")).toBe(true);
    expect(canTransitionCancellation("under_review", "approved")).toBe(true);
    expect(canTransitionCancellation("rejected", "approved")).toBe(false);
  });

  it("allows return inspection to refund or exchange decision", () => {
    expect(canTransitionReturn("inspection", "refund_decision")).toBe(true);
    expect(canTransitionReturn("inspection", "exchange_decision")).toBe(true);
    expect(canTransitionReturn("completed", "requested")).toBe(false);
  });

  it("books a replacement only after replacement_ready", () => {
    expect(canTransitionExchange("approved", "replacement_ready")).toBe(true);
    expect(canTransitionExchange("replacement_ready", "replacement_booked")).toBe(true);
    expect(canTransitionExchange("requested", "replacement_booked")).toBe(false);
  });
});

describe("cancellation eligibility", () => {
  it("allows pre-shipment PostBus cancel and blocks booked shipments", () => {
    expect(canApprovePostbusCancellation("READY", false)).toBe(true);
    expect(canApprovePostbusCancellation("PROCESSING", false)).toBe(true);
    expect(canApprovePostbusCancellation("BOOKED", false)).toBe(false);
    expect(canApprovePostbusCancellation("READY", true)).toBe(false);
  });
});

describe("delivery status ranks", () => {
  it("ignores out-of-order delivered after read and keeps failed terminal", () => {
    expect(shouldApplyMessageStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyMessageStatus("read", "delivered")).toBe(false);
    expect(shouldApplyMessageStatus("failed", "sent")).toBe(false);
  });
});
