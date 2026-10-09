import type { MemberRole, Permission } from "@/types/domain";

const ALL: Permission[] = [
  "org.manage",
  "org.billing",
  "members.manage",
  "orders.read",
  "orders.write",
  "products.read",
  "products.write",
  "shipments.read",
  "shipments.write",
  "labels.read",
  "labels.write",
  "manifests.read",
  "manifests.write",
  "tracking.read",
  "tracking.pages",
  "automation.manage",
  "integrations.manage",
  "api_keys.manage",
  "webhooks.manage",
  "audit.read",
  "settings.manage",
  "support.read",
  "support.reply",
  "support.assign",
  "support.manage",
  "support.settings",
];

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((permission) => permission !== "org.billing"),
  MANAGER: [
    "support.read",
    "support.reply",
    "support.assign",
    "support.manage",
    "orders.read",
    "orders.write",
    "products.read",
    "products.write",
    "shipments.read",
    "shipments.write",
    "labels.read",
    "labels.write",
    "manifests.read",
    "manifests.write",
    "tracking.read",
    "tracking.pages",
    "automation.manage",
  ],
  OPERATOR: [
    "support.read",
    "support.reply",
    "orders.read",
    "orders.write",
    "products.read",
    "shipments.read",
    "shipments.write",
    "labels.read",
    "labels.write",
    "tracking.read",
  ],
  VIEWER: [
    "support.read",
    "orders.read",
    "products.read",
    "shipments.read",
    "labels.read",
    "manifests.read",
    "tracking.read",
    "audit.read",
  ],
};

export function permissionsFor(role: MemberRole): Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: MemberRole, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
