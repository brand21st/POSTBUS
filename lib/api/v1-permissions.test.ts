import { describe, expect, it } from "vitest";
import { canAssignMemberRole, permissionForTenantRoute } from "@/lib/api/v1-permissions";

describe("permissionForTenantRoute", () => {
  it("requires write permissions for mutating commerce routes", () => {
    expect(permissionForTenantRoute("GET", "orders", ["orders"])).toBe("orders.read");
    expect(permissionForTenantRoute("POST", "orders", ["orders"])).toBe("orders.write");
    expect(permissionForTenantRoute("POST", "shipments/abc/retry", ["shipments", "abc", "retry"])).toBe(
      "shipments.write"
    );
    expect(permissionForTenantRoute("POST", "manifests", ["manifests"])).toBe("manifests.write");
  });

  it("protects admin surfaces and keeps status reads open to members", () => {
    expect(permissionForTenantRoute("GET", "integrations", ["integrations"])).toBeUndefined();
    expect(permissionForTenantRoute("GET", "integrations/shopify/connect", ["integrations", "shopify", "connect"])).toBe(
      "integrations.manage"
    );
    expect(permissionForTenantRoute("POST", "integrations/shopify/sync", ["integrations", "shopify", "sync"])).toBe(
      "integrations.manage"
    );
    expect(permissionForTenantRoute("GET", "integrations/wati", ["integrations", "wati"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "integrations/wati", ["integrations", "wati"])).toBe(
      "integrations.manage"
    );
    expect(permissionForTenantRoute("GET", "members", ["members"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "members/invites", ["members", "invites"])).toBe(
      "members.manage"
    );
    expect(permissionForTenantRoute("POST", "api-keys", ["api-keys"])).toBe("api_keys.manage");
    expect(permissionForTenantRoute("GET", "webhooks", ["webhooks"])).toBe("webhooks.manage");
    expect(permissionForTenantRoute("GET", "audit-logs", ["audit-logs"])).toBe("audit.read");
    expect(permissionForTenantRoute("PATCH", "automation", ["automation"])).toBe("automation.manage");
    expect(permissionForTenantRoute("GET", "automation", ["automation"])).toBeUndefined();
    expect(permissionForTenantRoute("GET", "print-station", ["print-station"])).toBeUndefined();
    expect(permissionForTenantRoute("PATCH", "print-station", ["print-station"])).toBe("automation.manage");
    expect(permissionForTenantRoute("POST", "labels/abc/print", ["labels", "abc", "print"])).toBe(
      "labels.write"
    );
    expect(permissionForTenantRoute("POST", "labels/abc/regenerate", ["labels", "abc", "regenerate"])).toBe(
      "labels.write"
    );
    expect(permissionForTenantRoute("GET", "label-template", ["label-template"])).toBe("labels.read");
    expect(permissionForTenantRoute("PUT", "label-template", ["label-template"])).toBe("labels.write");
    expect(permissionForTenantRoute("GET", "invoices", ["invoices"])).toBe("orders.read");
    expect(permissionForTenantRoute("GET", "invoices/abc/download", ["invoices", "abc", "download"])).toBe(
      "orders.read"
    );
    expect(permissionForTenantRoute("POST", "invoices/abc/retry", ["invoices", "abc", "retry"])).toBe(
      "orders.write"
    );
    expect(permissionForTenantRoute("POST", "invoices/abc/regenerate", ["invoices", "abc", "regenerate"])).toBe(
      "orders.write"
    );
    expect(permissionForTenantRoute("GET", "invoice-template", ["invoice-template"])).toBe("orders.read");
    expect(permissionForTenantRoute("PUT", "invoice-template", ["invoice-template"])).toBe("orders.write");
    expect(permissionForTenantRoute("POST", "label-template/print-test", ["label-template", "print-test"])).toBe(
      "labels.write"
    );
    expect(permissionForTenantRoute("GET", "notifications", ["notifications"])).toBeUndefined();
  });

  it("prevents admins from assigning owner or admin roles", () => {
    expect(canAssignMemberRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignMemberRole("ADMIN", "OPERATOR")).toBe(true);
    expect(canAssignMemberRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignMemberRole("OPERATOR", "VIEWER")).toBe(false);
  });
});
