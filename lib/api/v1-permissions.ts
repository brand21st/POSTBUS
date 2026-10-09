import type { Permission } from "@/types/domain";

export function permissionForTenantRoute(
  method: string,
  path: string,
  slugs: string[]
): Permission | undefined {
  const key = `${method} ${path}`;
  const root = slugs[0];

  if (path.startsWith("dashboard/")) return "orders.read";

  if (root === "bookings") {
    return method === "GET" ? "shipments.read" : "shipments.write";
  }

  if (root === "products") {
    if (method === "GET") return "products.read";
    return "products.write";
  }

  if (root === "inventory") {
    return method === "GET" ? "products.read" : "products.write";
  }

  if (root === "orders") {
    if (method === "POST" && slugs[1] === "bulk" && slugs[2] === "status") return "shipments.write";
    if (method === "PATCH" && slugs[2] === "service") return "orders.write";
    if (method === "PATCH" && slugs[2] === "weights") return "orders.write";
    if (method === "PATCH" && slugs[2] === "address") return "orders.write";
    return method === "POST" ? "orders.write" : "orders.read";
  }

  if (root === "shipments") {
    return method === "POST" ? "shipments.write" : "shipments.read";
  }

  if (root === "ndr-rto") {
    return method === "POST" ? "shipments.write" : "shipments.read";
  }

  if (root === "label-template") {
    if (method === "GET") return "labels.read";
    if (slugs[1] === "custom-preview" || slugs[1] === "custom-download" || slugs[1] === "multi-sheet") {
      return "labels.read";
    }
    return "labels.write";
  }

  if (root === "invoice-template") {
    return method === "GET" ? "orders.read" : "orders.write";
  }

  if (root === "invoices") {
    if (method === "POST" && (slugs[2] === "retry" || slugs[2] === "regenerate")) return "orders.write";
    return "orders.read";
  }

  if (root === "labels") {
    if (
      method === "POST" &&
      (slugs[1] === "retry-incomplete" ||
        slugs[2] === "print" ||
        slugs[2] === "regenerate" ||
        slugs[2] === "india-post" ||
        slugs[2] === "retry" ||
        slugs[2] === "packing-slip")
    ) {
      return "labels.write";
    }
    return "labels.read";
  }

  if (root === "print-station") {
    if (method === "GET") return undefined;
    return "automation.manage";
  }

  if (root === "printers") {
    if (method === "GET") return undefined;
    if (method === "POST" && slugs[2] === "presence") return "labels.write";
    return "automation.manage";
  }

  if (root === "print-jobs") {
    if (method === "GET") return "labels.read";
    if (slugs[2] === "claim" || slugs[2] === "complete") return "labels.write";
  }

  if (root === "manifests") {
    return method === "POST" ? "manifests.write" : "manifests.read";
  }

  if (path === "tracking") return "tracking.read";

  if (key === "PATCH automation") return "automation.manage";
  if (key === "GET automation") return undefined;

  if (key === "PATCH integrations/india-post/booking-service") return "shipments.write";
  if (key === "PATCH integrations/india-post/default-service") return "integrations.manage";
  if (key === "PATCH integrations/india-post/parcel-defaults") return "org.manage";

  if (root === "integrations") {
    const readable =
      key === "GET integrations" ||
      key === "GET integrations/shopify" ||
      key === "GET integrations/india-post" ||
      key === "GET integrations/india-post/offices" ||
      key === "GET integrations/wati" ||
      key === "GET integrations/wati/templates" ||
      key === "GET integrations/vachat";
    return readable ? undefined : "integrations.manage";
  }

  if (key === "PATCH organizations") return "org.manage";

  if (root === "ai-credits") return "orders.read";

  if (root === "billing") {
    if (method === "GET") return undefined;
    return "org.billing";
  }

  if (path === "notifications") return undefined;

  if (key === "GET members") return undefined;
  if (root === "members") return "members.manage";

  if (key === "GET settings/notifications") return undefined;
  if (key === "GET settings/policies") return undefined;
  if (key === "PATCH settings/policies") return "settings.manage";
  if (root === "settings") return "settings.manage";

  if (root === "api-keys") return "api_keys.manage";

  if (path === "webhooks") return "webhooks.manage";

  if (path === "audit-logs") return "audit.read";

  if (path === "search") return "orders.read";

  if (root === "shipment-presets") {
    return method === "GET" ? "orders.read" : "orders.write";
  }

  if (root === "support") {
    if (method === "GET") return "support.read";
    if (slugs[1] === "settings") return "support.settings";
    if (slugs[3] === "messages" || slugs[3] === "templates" || slugs[3] === "read") return "support.reply";
    if (slugs[1] === "tickets" && slugs[3] === "notes") return "support.reply";
    if (slugs[1] === "tickets" && slugs[3] === "assign") return "support.assign";
    if (method === "POST" && slugs[1] === "tickets" && !slugs[2]) return "support.manage";
    return "support.manage";
  }

  if (root === "ui") return undefined;

  if (root === "tutorials") {
    return method === "GET" ? undefined : "org.manage";
  }

  return undefined;
}

export function canAssignMemberRole(
  actorRole: "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER",
  assignedRole: "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER"
) {
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return assignedRole !== "OWNER" && assignedRole !== "ADMIN";
  return false;
}
