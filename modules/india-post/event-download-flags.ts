const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optional(value: string | undefined) {
  return value?.trim() || "";
}

function isAllowAllToken(value: string) {
  return value === "*" || value === "all";
}

/** Production empty = no orgs. Local/test default `*` so unit tests do not need env. */
export function indiaPostEventDownloadOrgAllowlist() {
  const configured = optional(process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST);
  const raw =
    configured ||
    (process.env.NODE_ENV === "production" ? "" : "*");
  if (isAllowAllToken(raw.toLowerCase())) return ["*"];
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UUID.test(value));
}

export function isIndiaPostEventDownloadOpenForOrg(organizationId?: string | null) {
  if (!organizationId) return false;
  const list = indiaPostEventDownloadOrgAllowlist();
  if (!list.length) return false;
  if (list.includes("*")) return true;
  return list.includes(organizationId.toLowerCase());
}
