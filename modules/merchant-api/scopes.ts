export const MERCHANT_API_SCOPES = [
  "orders:read",
  "orders:write",
  "shipments:read",
  "shipments:book",
  "tracking:read",
  "labels:read",
  "webhooks:read",
  "webhooks:manage",
] as const;

export type MerchantApiScope = (typeof MERCHANT_API_SCOPES)[number];

export const MERCHANT_API_VERSION = "v1";

export function isMerchantApiScope(value: string): value is MerchantApiScope {
  return (MERCHANT_API_SCOPES as readonly string[]).includes(value);
}

export function normalizeScopes(values: unknown): MerchantApiScope[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<MerchantApiScope>();
  for (const value of values) {
    if (typeof value === "string" && isMerchantApiScope(value)) unique.add(value);
  }
  return [...unique];
}

export function hasScope(scopes: readonly string[], required: MerchantApiScope) {
  return scopes.includes(required);
}
