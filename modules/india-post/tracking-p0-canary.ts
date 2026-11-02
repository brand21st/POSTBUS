export const TRACKING_P0_CANARY_AWB_MAX = 5;

function optionalEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function normalizeId(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAwb(value: string) {
  return value.trim().toUpperCase();
}

export function trackingP0CanaryOrganizationId() {
  return optionalEnv("INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID");
}

export function trackingP0CanaryActive() {
  return Boolean(trackingP0CanaryOrganizationId());
}

export function isTrackingP0CanaryOrganization(organizationId: string) {
  const configured = trackingP0CanaryOrganizationId();
  if (!configured) return false;
  return normalizeId(configured) === normalizeId(organizationId);
}

export function trackingP0CanaryAllowlist() {
  const raw = optionalEnv("INDIA_POST_TRACKING_P0_CANARY_AWBS");
  const unique = [...new Set(raw.split(",").map(normalizeAwb).filter(Boolean))];
  return unique.slice(0, TRACKING_P0_CANARY_AWB_MAX);
}

export function trackingP0CanarySideEffectsEnabled() {
  return optionalEnv("INDIA_POST_TRACKING_P0_CANARY_SIDE_EFFECTS").toLowerCase() === "on";
}

export function isTrackingP0CanaryAwb(organizationId: string, barcode: string) {
  if (!isTrackingP0CanaryOrganization(organizationId)) return false;
  const allow = trackingP0CanaryAllowlist();
  if (!allow.length) return false;
  return allow.includes(normalizeAwb(barcode));
}

export function filterTrackingP0CanaryShipments<T extends { barcode?: string | null }>(
  organizationId: string,
  rows: T[]
) {
  const allow = new Set(trackingP0CanaryAllowlist());
  if (!isTrackingP0CanaryOrganization(organizationId) || !allow.size) return [];
  return rows.filter((row) => allow.has(normalizeAwb(String(row.barcode ?? ""))));
}

export function assertTrackingP0CanaryQuery(organizationId: string, barcodes: string[]) {
  if (!trackingP0CanaryActive()) {
    throw Object.assign(new Error("Tracking P0 canary is not armed."), { code: "TRACKING_P0_CANARY_OFF" });
  }
  if (!isTrackingP0CanaryOrganization(organizationId)) {
    throw Object.assign(new Error("Organization is not the tracking P0 canary."), {
      code: "TRACKING_P0_CANARY_ORG",
    });
  }
  const allow = trackingP0CanaryAllowlist();
  if (!allow.length) {
    throw Object.assign(new Error("Tracking P0 canary AWB allowlist is empty."), {
      code: "TRACKING_P0_CANARY_ALLOWLIST",
    });
  }
  const allowed = new Set(allow);
  const extra = barcodes.map(normalizeAwb).filter((code) => code && !allowed.has(code));
  if (extra.length) {
    throw Object.assign(new Error("AWB is not on the tracking P0 canary allowlist."), {
      code: "TRACKING_P0_CANARY_AWB",
    });
  }
  if (barcodes.filter(Boolean).length > TRACKING_P0_CANARY_AWB_MAX) {
    throw Object.assign(new Error("Tracking P0 canary allows at most 5 AWBs."), {
      code: "TRACKING_P0_CANARY_LIMIT",
    });
  }
}
