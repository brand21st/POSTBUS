import { describe, expect, it } from "vitest";
import { hasPermission, permissionsFor } from "@/lib/permissions/rbac";

describe("rbac", () => {
  it("gives owners billing and viewers read-only", () => {
    expect(hasPermission("OWNER", "org.billing")).toBe(true);
    expect(hasPermission("ADMIN", "org.billing")).toBe(false);
    expect(hasPermission("VIEWER", "orders.write")).toBe(false);
    expect(hasPermission("OPERATOR", "orders.write")).toBe(true);
    expect(hasPermission("MANAGER", "automation.manage")).toBe(true);
  });

  it("lists permissions for a role", () => {
    expect(permissionsFor("VIEWER")).not.toContain("orders.write");
    expect(permissionsFor("OWNER")).toContain("org.billing");
  });
});
