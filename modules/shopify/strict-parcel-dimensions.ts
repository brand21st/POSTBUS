const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optional(value: string | undefined) {
  return value?.trim() || "";
}

function isAllowAllToken(value: string) {
  return value === "*" || value === "all";
}

const PUBLIC_ALLOWLIST = process.env.NEXT_PUBLIC_STRICT_PARCEL_DIMENSIONS_ORG_IDS;

export function strictParcelDimensionsOrgAllowlist(
  raw = process.env.POSTBUS_STRICT_PARCEL_DIMENSIONS_ORG_IDS || PUBLIC_ALLOWLIST
) {
  const value = optional(raw);
  if (isAllowAllToken(value.toLowerCase())) return ["*"];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => UUID.test(item));
}

/** Empty allowlist keeps live 14 × 9 × 1 cm booking fill for every organization. */
export function isStrictParcelDimensionsOrg(organizationId?: string | null) {
  if (!organizationId) return false;
  const list = strictParcelDimensionsOrgAllowlist();
  if (!list.length) return false;
  if (list.includes("*")) return true;
  return list.includes(organizationId.toLowerCase());
}
