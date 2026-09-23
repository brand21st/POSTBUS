import type { Permission } from "@/types/domain";

export function permissionForTenantRoute(
  method: string,
  path: string,
  slugs: string[]
): Permission | undefined {
  const key = `${method} ${path}`;
  const root = slugs[0];

  if (path.startsWith("dashboard/")) return "orders.read";

  if (root === "orders") {
    return method === "POST" ? "orders.write" : "orders.read";
  }

  if (root === "shipments") {
    return method === "POST" ? "shipments.write" : "shipments.read";
  }

  if (root === "label-template") {
    return method === "GET" ? "labels.read" : "labels.write";
  }

  if (root === "invoice-template") {
    return method === "GET" ? "orders.read" : "orders.write";
  }

  if (root === "invoices") {
    if (method === "POST" && (slugs[2] === "retry" || slugs[2] === "regenerate")) return "orders.write";
    return "orders.read";
  }

  if (root === "labels") {
    if (method === "POST" && (slugs[2] === "print" || slugs[2] === "regenerate")) return "labels.write";
    return "labels.read";
  }

  if (root === "print-station") {
    if (method === "GET") return undefined;
    return "automation.manage";
  }

  if (root === "manifests") {
    return method === "POST" ? "manifests.write" : "manifests.read";
  }

  if (path === "tracking") return "tracking.read";

  if (key === "PATCH automation") return "automation.manage";
  if (key === "GET automation") return undefined;

  if (root === "integrations") {
    const readable =
      key === "GET integrations" ||
      key === "GET integrations/shopify" ||
      key === "GET integrations/india-post" ||
      key === "GET integrations/wati" ||
      key === "GET integrations/wati/templates";
    return readable ? undefined : "integrations.manage";
  }

  if (key === "PATCH organizations") return "org.manage";

  if (path === "billing") return undefined;

  if (path === "notifications") return undefined;

  if (key === "GET members") return undefined;
  if (root === "members") return "members.manage";

  if (key === "GET settings/notifications") return undefined;
  if (root === "settings") return "settings.manage";

  if (root === "api-keys") return "api_keys.manage";

  if (path === "webhooks") return "webhooks.manage";

  if (path === "audit-logs") return "audit.read";

  if (path === "search") return "orders.read";

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
