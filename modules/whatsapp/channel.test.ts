import { describe, expect, it } from "vitest";
import { isOrgWatiConnected, isWatiConnectionActive } from "@/modules/whatsapp/channel";

describe("WhatsApp channel", () => {
  it("treats CONNECTED WATI as the active sender", () => {
    expect(isWatiConnectionActive("CONNECTED")).toBe(true);
    expect(isWatiConnectionActive("connected")).toBe(true);
    expect(isWatiConnectionActive("NOT_CONNECTED")).toBe(false);
  });

  it("reads the tenant WATI connection status", async () => {
    const connected = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { status: "CONNECTED" } }),
          }),
        }),
      }),
    };
    const idle = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { status: "NOT_CONNECTED" } }),
          }),
        }),
      }),
    };
    await expect(isOrgWatiConnected(connected as never, "org-1")).resolves.toBe(true);
    await expect(isOrgWatiConnected(idle as never, "org-1")).resolves.toBe(false);
  });
});
