import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/api/context";
import { handleWorkspaceRoutes } from "@/lib/api/v1/workspace";

vi.mock("@/modules/vachat/knowledge", () => ({
  scheduleMerchantKnowledgeSync: vi.fn(),
}));

const ctx = {
  userId: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OWNER",
  permissions: ["settings.manage"],
} as TenantContext;

function policiesDb(row: Record<string, unknown> | null) {
  let stored = row;
  return {
    get stored() {
      return stored;
    },
    client: {
      from(table: string) {
        if (table !== "organization_policies") throw new Error(`unexpected table ${table}`);
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: stored, error: null };
                  },
                };
              },
            };
          },
          upsert(payload: Record<string, unknown>) {
            stored = payload;
            return {
              select() {
                return {
                  async single() {
                    return { data: stored, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

describe("settings/policies", () => {
  it("returns empty defaults when no row exists", async () => {
    const db = policiesDb(null);
    const result = await handleWorkspaceRoutes(
      new NextRequest("http://localhost/api/v1/settings/policies"),
      db.client as never,
      ctx,
      "GET settings/policies",
      "GET",
      ["settings", "policies"]
    );
    expect(result).toMatchObject({
      shippingPolicyBody: "",
      shippingPolicyEnabled: true,
      contactEnabled: true,
    });
  });

  it("upserts a shipping policy and extra keywords", async () => {
    const db = policiesDb(null);
    const request = new NextRequest("http://localhost/api/v1/settings/policies", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shippingPolicyBody: "Dispatch in 2 days.",
        shippingPolicyKeywords: "cod charges,  COD charges",
        shippingPolicyEnabled: true,
      }),
    });
    const result = await handleWorkspaceRoutes(
      request,
      db.client as never,
      ctx,
      "PATCH settings/policies",
      "PATCH",
      ["settings", "policies"]
    );
    expect(result).toMatchObject({
      shippingPolicyBody: "Dispatch in 2 days.",
      shippingPolicyKeywords: ["cod charges"],
      shippingPolicyEnabled: true,
    });
    expect(db.stored).toMatchObject({
      organization_id: "org-1",
      shipping_policy_body: "Dispatch in 2 days.",
      shipping_policy_keywords: ["cod charges"],
    });
  });
});
