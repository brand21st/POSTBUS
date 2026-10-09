import { describe, expect, it } from "vitest";
import { breadcrumbs, isNavItemActive, isResourceIdSegment, sidebarNav, tutorialsNav } from "@/lib/dashboard/nav";

describe("Support Center navigation", () => {
  it("places Support Center after Automation", () => {
    const support = sidebarNav.find((entry) => entry.href === "/dashboard/support");
    expect(support?.label).toBe("Support Center");
    expect(sidebarNav.findIndex((entry) => entry.href === "/dashboard/automation")).toBeLessThan(
      sidebarNav.findIndex((entry) => entry.href === "/dashboard/support")
    );
  });
});

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

describe("breadcrumb resource ids", () => {
  it("keeps order UUIDs as ids instead of splitting them into words", () => {
    const crumbs = breadcrumbs("/dashboard/orders/c8c64456-d324-4277-9577-c3ee1086fccf");
    expect(isResourceIdSegment("c8c64456-d324-4277-9577-c3ee1086fccf")).toBe(true);
    expect(crumbs.at(-1)).toMatchObject({
      href: "/dashboard/orders/c8c64456-d324-4277-9577-c3ee1086fccf",
      resourceId: true,
      label: "c8c64456-d324-4277-9577-c3ee1086fccf",
    });
    expect(crumbs.at(-1)?.label).not.toContain(" ");
  });
});

describe("YouTube Tutorials navigation", () => {
  it("adds a help-cluster item pointing at the merchant tutorials page", () => {
    expect(tutorialsNav.label).toBe("YouTube Tutorials");
    expect(tutorialsNav.href).toBe("/dashboard/tutorials");
    expect(isNavItemActive("/dashboard/tutorials", "/dashboard/tutorials")).toBe(true);
    expect(isNavItemActive("/dashboard/tutorials", "/dashboard/orders")).toBe(false);
  });
});
