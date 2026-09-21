import { describe, expect, it, vi } from "vitest";
import { ensureActiveWorkspace } from "@/modules/organizations/service";

function membership(id: string, name: string, createdAt: string) {
  return {
    role: "OWNER",
    organization_id: id,
    organizations: { id, name, slug: name.toLowerCase(), created_at: createdAt },
  };
}

function supabaseMock(rpc: ReturnType<typeof vi.fn>, membershipsForList: unknown[]) {
  return {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "organization_members") {
        return { select: () => ({ eq: () => ({ data: membershipsForList, error: null }) }) };
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
    expect(result.memberships).toHaveLength(1);
  });

  it("does not create a second workspace when memberships already exist", async () => {
    const rpc = vi.fn();
    const supabase = supabaseMock(rpc, [membership("org-1", "One", "2026-09-21T00:00:00Z")]);

    const result = await ensureActiveWorkspace(supabase as never, "user-1", {
      activeOrganizationId: "org-1",
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(result.memberships).toHaveLength(1);
    expect(result.current?.id).toBe("org-1");
  });

  it("exposes only the active workspace when several exist", async () => {
    const rpc = vi.fn();
    const supabase = supabaseMock(rpc, [
      membership("org-2", "Second", "2026-09-21T12:00:00Z"),
      membership("org-1", "First", "2026-09-21T00:00:00Z"),
    ]);

    const result = await ensureActiveWorkspace(supabase as never, "user-1", {
      activeOrganizationId: "org-2",
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(result.memberships).toHaveLength(1);
    expect(result.current?.id).toBe("org-2");
  });

  it("falls back to the oldest workspace when none is active", async () => {
    const rpc = vi.fn();
    const supabase = supabaseMock(rpc, [
      membership("org-2", "Second", "2026-09-21T12:00:00Z"),
      membership("org-1", "First", "2026-09-21T00:00:00Z"),
    ]);

    const result = await ensureActiveWorkspace(supabase as never, "user-1", {});

    expect(rpc).not.toHaveBeenCalled();
    expect(result.memberships).toHaveLength(1);
    expect(result.current?.id).toBe("org-1");
  });
});
