const CLAIM_ALLOWLIST = [
  "iss",
  "aud",
  "sub",
  "exp",
  "iat",
  "nbf",
  "scope",
  "scp",
  "roles",
  "role",
  "client_id",
  "azp",
  "typ",
  "token_use",
  "preferred_username",
  "oid",
  "tid",
  "azp",
  "appid",
  "application_id",
  "customer_id",
  "cust_id",
  "customerId",
  "realm",
  "permissions",
  "groups",
  "jti",
] as const;

function b64urlJson(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function roleNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const roles = (value as { roles?: unknown }).roles;
  return Array.isArray(roles) ? roles.map((role) => String(role)).filter(Boolean) : [];
}

function pickClaims(payload: Record<string, unknown>) {
  const claims: Record<string, unknown> = {};
  const present: string[] = Object.keys(payload).sort();
  for (const key of CLAIM_ALLOWLIST) {
    if (key in payload) claims[key] = payload[key];
  }
  if (payload.realm_access) claims.realm_roles = roleNames(payload.realm_access);
  if (payload.resource_access && typeof payload.resource_access === "object") {
    const clients: Record<string, string[]> = {};
    for (const [client, access] of Object.entries(payload.resource_access as Record<string, unknown>)) {
      clients[client] = roleNames(access);
    }
    claims.resource_roles = clients;
  }
  return { present, claims };
}

export type TokenInspection = {
  kind: "access_token" | "id_token" | "refresh_token";
  format: "JWT" | "OPAQUE" | "UNKNOWN";
  signatureVerified: false;
  header?: { alg?: unknown; typ?: unknown; kidPresent: boolean };
  claimNames: string[];
  claims: Record<string, unknown>;
  expIso?: string;
  iatIso?: string;
  expiredAtInspection?: boolean;
};

export function inspectToken(kind: TokenInspection["kind"], value: string | undefined): TokenInspection | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) {
    return {
      kind,
      format: parts.length === 1 ? "OPAQUE" : "UNKNOWN",
      signatureVerified: false,
      claimNames: [],
      claims: {},
    };
  }
  const header = b64urlJson(parts[0]) ?? {};
  const payload = b64urlJson(parts[1]) ?? {};
  const picked = pickClaims(payload);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  return {
    kind,
    format: "JWT",
    signatureVerified: false,
    header: { alg: header.alg, typ: header.typ, kidPresent: Boolean(header.kid) },
    claimNames: picked.present,
    claims: picked.claims,
    expIso: exp ? new Date(exp * 1000).toISOString() : undefined,
    iatIso: iat ? new Date(iat * 1000).toISOString() : undefined,
    expiredAtInspection: exp != null ? exp * 1000 <= Date.now() : undefined,
  };
}
