import type { MemberRole, Permission } from "@/types/domain";

const ALL: Permission[] = [
  "org.manage",
  "org.billing",
  "members.manage",
  "orders.read",
  "orders.write",
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
];

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((permission) => permission !== "org.billing"),
  MANAGER: [
    "orders.read",
    "orders.write",
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
    "orders.read",
    "orders.write",
    "shipments.read",
    "shipments.write",
    "labels.read",
    "labels.write",
    "tracking.read",
  ],
  VIEWER: [
    "orders.read",
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
