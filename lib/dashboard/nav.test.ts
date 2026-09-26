import { describe, expect, it } from "vitest";
import { isNavItemActive, sidebarNav } from "@/lib/dashboard/nav";

describe("NDR & RTO navigation", () => {
  it("adds the item with the existing sidebar shape", () => {
    const item = sidebarNav.find((entry) => entry.href === "/dashboard/ndr-rto");
    expect(item?.label).toBe("NDR & RTO");
    expect(sidebarNav.findIndex((entry) => entry.href === "/dashboard/shipments")).toBeLessThan(
      sidebarNav.findIndex((entry) => entry.href === "/dashboard/ndr-rto")
    );
  });

  it("keeps the dashboard exact-match rule and prefix-matches the new page", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavItemActive("/dashboard", "/dashboard/ndr-rto")).toBe(false);
    expect(isNavItemActive("/dashboard/ndr-rto", "/dashboard/ndr-rto")).toBe(true);
    expect(isNavItemActive("/dashboard/shipments", "/dashboard/ndr-rto")).toBe(false);
  });
});
