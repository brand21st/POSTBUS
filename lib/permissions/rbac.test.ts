import { describe, expect, it } from "vitest";
import { hasPermission, permissionsFor } from "@/lib/permissions/rbac";

describe("rbac", () => {
  it("gives owners billing and viewers read-only", () => {
    expect(hasPermission("OWNER", "org.billing")).toBe(true);
    expect(hasPermission("ADMIN", "org.billing")).toBe(false);
    expect(hasPermission("VIEWER", "orders.write")).toBe(false);
    expect(hasPermission("OPERATOR", "orders.write")).toBe(true);
    expect(hasPermission("OPERATOR", "products.write")).toBe(false);
    expect(hasPermission("OPERATOR", "products.read")).toBe(true);
    expect(hasPermission("MANAGER", "products.write")).toBe(true);
    expect(hasPermission("VIEWER", "products.write")).toBe(false);
    expect(hasPermission("VIEWER", "products.read")).toBe(true);
    expect(hasPermission("VIEWER", "support.read")).toBe(true);
    expect(hasPermission("VIEWER", "support.settings")).toBe(false);
    expect(hasPermission("VIEWER", "support.reply")).toBe(false);
    expect(hasPermission("OPERATOR", "support.reply")).toBe(true);
    expect(hasPermission("OPERATOR", "support.assign")).toBe(false);
    expect(hasPermission("MANAGER", "support.assign")).toBe(true);
    expect(hasPermission("MANAGER", "support.settings")).toBe(false);
    expect(hasPermission("ADMIN", "support.settings")).toBe(true);
  });

  it("lists permissions for a role", () => {
    expect(permissionsFor("VIEWER")).not.toContain("orders.write");
    expect(permissionsFor("OWNER")).toContain("org.billing");
  });
});
