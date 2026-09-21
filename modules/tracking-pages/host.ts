import {
  APEX_HOSTS,
  PRODUCTION_APEX_HOST,
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_PATTERN,
  TEMP_APEX_HOST,
  TRACKING_PARENT_HOSTS,
} from "./constants";

export function hostnameFromHost(host: string | null | undefined) {
  return (host ?? "").split(":")[0]?.trim().toLowerCase() ?? "";
}

export function publicApexHost() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const hostname = new URL(appUrl).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") return "localhost";
    const apex = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    if (apex === TEMP_APEX_HOST || apex.endsWith(`.${TEMP_APEX_HOST}`)) {
      return PRODUCTION_APEX_HOST;
    }
    return apex;
  } catch {
    return PRODUCTION_APEX_HOST;
  }
}

export function trackingHostSuffix() {
  return `.${publicApexHost()}`;
}

export function parseTrackingSubdomain(host: string | null | undefined): string | null {
  const hostname = hostnameFromHost(host);
  if (!hostname || APEX_HOSTS.has(hostname)) return null;

  let label: string | null = null;
  if (hostname.endsWith(".localhost")) {
    label = hostname.slice(0, -".localhost".length);
  } else {
    for (const parent of TRACKING_PARENT_HOSTS) {
      if (hostname.endsWith(`.${parent}`)) {
        label = hostname.slice(0, -(parent.length + 1));
        break;
      }
    }
  }

  if (!label || label.includes(".")) return null;
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(label)) return null;
  if (!SUBDOMAIN_PATTERN.test(label)) return null;
  return label;
}

export function classifySubdomain(raw: string | null | undefined) {
  const subdomain = (raw ?? "").trim().toLowerCase();
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    return { subdomain, reason: "invalid" as const };
  }
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(subdomain)) {
    return { subdomain, reason: "reserved" as const };
  }
  return { subdomain, reason: "ok" as const };
}

export function trackingPagePublicUrl(subdomain: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const url = new URL(appUrl);
    const hostname = url.hostname.toLowerCase();
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocal) {
      const port = url.port || "3000";
      return `http://${subdomain}.localhost:${port}`;
    }
    const apex = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    if (apex === TEMP_APEX_HOST || apex.endsWith(`.${TEMP_APEX_HOST}`)) {
      return `https://${subdomain}.${PRODUCTION_APEX_HOST}`;
    }
    return `https://${subdomain}.${apex}`;
  } catch {
    return `https://${subdomain}.${PRODUCTION_APEX_HOST}`;
  }
}

export function publicObjectUrl(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/tracking-pages/${path}`;
}
