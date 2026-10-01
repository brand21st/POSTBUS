import { env } from "@/lib/env";
import { trackingPagePublicUrl } from "./host";

type CoolifyConfig = {
  baseUrl: string;
  applicationUuid: string;
  apiToken: string;
};

export type CoolifyDomainSyncResult =
  | { synced: false; reason: "not_configured" | "invalid_subdomain" }
  | { synced: true; domain: string; added: boolean; restarted: boolean };

function coolifyConfig(): CoolifyConfig | null {
  const baseUrl = env.coolifyBaseUrl;
  const applicationUuid = env.coolifyApplicationUuid;
  const apiToken = env.coolifyApiToken;
  if (!baseUrl || !applicationUuid || !apiToken) return null;
  return { baseUrl, applicationUuid, apiToken };
}

function parseDomains(fqdn: string | null | undefined) {
  return (fqdn ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function coolifyApi<T>(
  config: CoolifyConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>
) {
  const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message)
        : text || `${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function ensureCoolifyTrackingDomain(subdomain: string): Promise<CoolifyDomainSyncResult> {
  const label = subdomain.trim().toLowerCase();
  if (!label) return { synced: false, reason: "invalid_subdomain" };

  const config = coolifyConfig();
  if (!config) return { synced: false, reason: "not_configured" };

  const domain = trackingPagePublicUrl(label);
  const app = await coolifyApi<{ fqdn?: string }>(
    config,
    "GET",
    `/applications/${config.applicationUuid}`
  );
  const domains = parseDomains(app.fqdn);
  if (domains.includes(domain)) {
    return { synced: true, domain, added: false, restarted: false };
  }

  domains.push(domain);
  await coolifyApi(config, "PATCH", `/applications/${config.applicationUuid}`, {
    domains: domains.join(","),
    instant_deploy: false,
  });
  await coolifyApi(config, "POST", `/applications/${config.applicationUuid}/restart`);
  return { synced: true, domain, added: true, restarted: true };
}
