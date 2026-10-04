import { describe, expect, it } from "vitest";
import { canAssignMemberRole, permissionForTenantRoute } from "@/lib/api/v1-permissions";

describe("permissionForTenantRoute", () => {
  it("requires write permissions for mutating commerce routes", () => {
    expect(permissionForTenantRoute("GET", "orders", ["orders"])).toBe("orders.read");
    expect(permissionForTenantRoute("POST", "orders", ["orders"])).toBe("orders.write");
    expect(permissionForTenantRoute("POST", "orders/bulk/status", ["orders", "bulk", "status"])).toBe(
      "shipments.write"
    );
    expect(permissionForTenantRoute("POST", "bookings/validate", ["bookings", "validate"])).toBe("shipments.write");
    expect(permissionForTenantRoute("GET", "bookings/summary", ["bookings", "summary"])).toBe("shipments.read");
    expect(permissionForTenantRoute("PATCH", "orders/abc/service", ["orders", "abc", "service"])).toBe(
      "orders.write"
    );
    expect(
      permissionForTenantRoute("PATCH", "integrations/india-post/booking-service", [
        "integrations",
        "india-post",
        "booking-service",
      ])
    ).toBe("shipments.write");
    expect(
      permissionForTenantRoute("PATCH", "integrations/india-post/parcel-defaults", [
        "integrations",
        "india-post",
        "parcel-defaults",
      ])
    ).toBe("org.manage");
    expect(permissionForTenantRoute("POST", "shipments/abc/retry", ["shipments", "abc", "retry"])).toBe(
      "shipments.write"
    );
    expect(permissionForTenantRoute("GET", "ndr-rto", ["ndr-rto"])).toBe("shipments.read");
    expect(permissionForTenantRoute("GET", "ndr-rto/summary", ["ndr-rto", "summary"])).toBe("shipments.read");
    expect(permissionForTenantRoute("POST", "ndr-rto/abc/sync", ["ndr-rto", "abc", "sync"])).toBe(
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
    expect(permissionForTenantRoute("GET", "integrations/vachat", ["integrations", "vachat"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "integrations/vachat", ["integrations", "vachat"])).toBe(
      "integrations.manage"
    );
    expect(
      permissionForTenantRoute("POST", "integrations/vachat/send-test", ["integrations", "vachat", "send-test"])
    ).toBe("integrations.manage");
    expect(
      permissionForTenantRoute("GET", "integrations/india-post/offices", ["integrations", "india-post", "offices"])
    ).toBeUndefined();
    expect(
      permissionForTenantRoute("PATCH", "integrations/india-post/office", ["integrations", "india-post", "office"])
    ).toBe("integrations.manage");
    expect(
      permissionForTenantRoute("PATCH", "integrations/india-post/contracts", [
        "integrations",
        "india-post",
        "contracts",
      ])
    ).toBe("integrations.manage");
    expect(
      permissionForTenantRoute("DELETE", "integrations/india-post", ["integrations", "india-post"])
    ).toBe("integrations.manage");
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
    expect(permissionForTenantRoute("GET", "printers", ["printers"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "printers", ["printers"])).toBe("automation.manage");
    expect(permissionForTenantRoute("PATCH", "printers/printer-1", ["printers", "printer-1"])).toBe(
      "automation.manage"
    );
    expect(permissionForTenantRoute("DELETE", "printers/printer-1", ["printers", "printer-1"])).toBe(
      "automation.manage"
    );
    expect(permissionForTenantRoute("POST", "printers/printer-1/presence", ["printers", "printer-1", "presence"])).toBe(
      "labels.write"
    );
    expect(permissionForTenantRoute("GET", "print-jobs", ["print-jobs"])).toBe("labels.read");
    expect(permissionForTenantRoute("POST", "print-jobs/job-1/claim", ["print-jobs", "job-1", "claim"])).toBe(
      "labels.write"
    );
    expect(permissionForTenantRoute("POST", "print-jobs/job-1/complete", ["print-jobs", "job-1", "complete"])).toBe(
      "labels.write"
    );
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
    expect(
      permissionForTenantRoute("POST", "label-template/custom-preview", ["label-template", "custom-preview"])
    ).toBe("labels.read");
    expect(
      permissionForTenantRoute("POST", "label-template/custom-download", ["label-template", "custom-download"])
    ).toBe("labels.read");
    expect(permissionForTenantRoute("POST", "label-template/custom-print", ["label-template", "custom-print"])).toBe(
      "labels.write"
    );
    expect(permissionForTenantRoute("POST", "label-template/multi-sheet", ["label-template", "multi-sheet"])).toBe(
      "labels.read"
    );
    expect(permissionForTenantRoute("GET", "label-template/custom-data", ["label-template", "custom-data"])).toBe(
      "labels.read"
    );
    expect(permissionForTenantRoute("GET", "notifications", ["notifications"])).toBeUndefined();
    expect(permissionForTenantRoute("GET", "billing", ["billing"])).toBeUndefined();
    expect(permissionForTenantRoute("GET", "billing/plans", ["billing", "plans"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "billing/subscribe", ["billing", "subscribe"])).toBe("org.billing");
    expect(permissionForTenantRoute("POST", "billing/cancel", ["billing", "cancel"])).toBe("org.billing");
    expect(permissionForTenantRoute("GET", "tutorials", ["tutorials"])).toBeUndefined();
    expect(permissionForTenantRoute("GET", "tutorials/categories", ["tutorials", "categories"])).toBeUndefined();
    expect(permissionForTenantRoute("GET", "tutorials/getting-started", ["tutorials", "getting-started"])).toBeUndefined();
    expect(permissionForTenantRoute("POST", "tutorials", ["tutorials"])).toBe("org.manage");
    expect(permissionForTenantRoute("PATCH", "tutorials/abc", ["tutorials", "abc"])).toBe("org.manage");
    expect(permissionForTenantRoute("DELETE", "tutorials/abc", ["tutorials", "abc"])).toBe("org.manage");
  });

  it("prevents admins from assigning owner or admin roles", () => {
    expect(canAssignMemberRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignMemberRole("ADMIN", "OPERATOR")).toBe(true);
    expect(canAssignMemberRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignMemberRole("OPERATOR", "VIEWER")).toBe(false);
  });
});
