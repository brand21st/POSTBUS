function optional(value: string | undefined) {
  return value?.trim() || "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isMerchantApiProcessEnabled() {
  return optional(process.env.MERCHANT_API_ENABLED).toLowerCase() !== "false";
}

function isAllowAllToken(value: string) {
  return value === "*" || value === "all";
}

export function merchantApiOrgAllowlist() {
  const raw = optional(process.env.MERCHANT_API_ORG_ALLOWLIST);
  if (isAllowAllToken(raw.toLowerCase())) return ["*"];
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UUID.test(value));
}

/** Empty allowlist disables every organization. `*` or `all` opens every workspace. Kill switch: MERCHANT_API_ENABLED=false. */
export function isMerchantApiOpenForOrg(organizationId?: string | null) {
  if (!isMerchantApiProcessEnabled()) return false;
  if (!organizationId) return false;
  const list = merchantApiOrgAllowlist();
  if (!list.length) return false;
  if (list.includes("*")) return true;
  return list.includes(organizationId.toLowerCase());
}

export function isMerchantWebhooksProcessEnabled() {
  return optional(process.env.MERCHANT_WEBHOOKS_ENABLED).toLowerCase() !== "false";
}

export function merchantWebhooksOrgAllowlist() {
  return optional(process.env.MERCHANT_WEBHOOKS_ORG_ALLOWLIST)
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UUID.test(value));
}

/** Empty allowlist disables outbound webhooks for every organization. */
export function isMerchantWebhooksOpenForOrg(organizationId?: string | null) {
  if (!isMerchantWebhooksProcessEnabled()) return false;
  if (!organizationId) return false;
  const list = merchantWebhooksOrgAllowlist();
  if (!list.length) return false;
  return list.includes(organizationId.toLowerCase());
}
