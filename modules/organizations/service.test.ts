import { describe, expect, it, vi } from "vitest";
import { ensureActiveWorkspace } from "@/modules/organizations/service";

function membership(id: string, name: string, createdAt: string) {
  return {
    role: "OWNER",
    organization_id: id,
    organizations: { id, name, slug: name.toLowerCase(), created_at: createdAt },
  };
}

describe("ensureActiveWorkspace", () => {
  it("creates one workspace when the user has none", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "org-1", name: "Priya", slug: "priya" },
      error: null,
    });
    const supabase = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === "organization_members") {
          const result = rpc.mock.calls.length
            ? { data: [membership("org-1", "Priya", "2026-09-21")], error: null }
            : { data: [], error: null };
          return { select: () => ({ eq: () => result }) };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: "m1" }, error: null }) }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }),
    };

    const result = await ensureActiveWorkspace(supabase as never, "user-1", {
      fullName: "Priya",
      email: "priya@example.com",
    });

    expect(rpc).toHaveBeenCalledWith("create_organization_for_user", { p_name: "Priya" });
    expect(result.current?.id).toBe("org-1");
  });

  it("does not create a second workspace when memberships already exist", async () => {
    const rpc = vi.fn();
    const supabase = {
      rpc,
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            data: [membership("org-1", "One", "2026-09-21T00:00:00Z")],
            error: null,
            eq: () => ({ maybeSingle: async () => ({ data: { id: "m1" } }) }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      })),
    };

    const result = await ensureActiveWorkspace(supabase as never, "user-1", {
      activeOrganizationId: "org-1",
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(result.memberships).toHaveLength(1);
    expect(result.current?.id).toBe("org-1");
  });
});
