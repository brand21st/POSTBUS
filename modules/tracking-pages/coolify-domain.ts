import { after } from "next/server";
import { env } from "@/lib/env";
import { logError } from "@/lib/logger";
import { trackingPagePublicUrl } from "./host";

type CoolifyConfig = {
  baseUrl: string;
  applicationUuid: string;
  apiToken: string;
};

export type HostProvisioningStatus = "live" | "connecting" | "skipped" | "failed";

export type HostProvisioning = {
  status: HostProvisioningStatus;
  domain: string;
  message: string;
};

export type CoolifyDomainSyncResult =
  | { synced: false; reason: "not_configured" | "invalid_subdomain" | "coolify_error"; message: string; domain: string }
  | { synced: true; domain: string; added: boolean; restarted: boolean; message: string };

function coolifyConfig(): CoolifyConfig | null {
  const baseUrl = env.coolifyBaseUrl.replace(/\/$/, "");
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

function parseJson(text: string) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function coolifyErrorMessage(data: unknown, text: string, status: number) {
  if (data && typeof data === "object" && "message" in data && (data as { message?: unknown }).message) {
    return String((data as { message?: unknown }).message);
  }
  return text.trim() || `Coolify returned ${status}`;
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
  const data = parseJson(text);
  if (!response.ok) {
    throw new Error(coolifyErrorMessage(data, text, response.status));
  }
  return data as T;
}

function scheduleRestart(config: CoolifyConfig) {
  const run = () =>
    coolifyApi(config, "POST", `/applications/${config.applicationUuid}/restart`).catch((error) => {
      logError("coolify.tracking-domain.restart", {
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

export function hostProvisioningFromSync(result: CoolifyDomainSyncResult): HostProvisioning {
  if (!result.synced) {
    return {
      status: result.reason === "coolify_error" ? "failed" : "skipped",
      domain: result.domain,
      message: result.message,
    };
  }
  if (result.added) {
    return {
      status: "connecting",
      domain: result.domain,
      message: `${result.domain} is connecting. It is usually live within a minute.`,
    };
  }
  return {
    status: "live",
    domain: result.domain,
    message: `${result.domain} is connected.`,
  };
}

export async function ensureCoolifyTrackingDomain(subdomain: string): Promise<CoolifyDomainSyncResult> {
  const label = subdomain.trim().toLowerCase();
  const domain = label ? trackingPagePublicUrl(label) : "";
  if (!label) {
    return {
      synced: false,
      reason: "invalid_subdomain",
      domain,
      message: "Enter a valid subdomain.",
    };
  }

  const config = coolifyConfig();
  if (!config) {
    return {
      synced: false,
      reason: "not_configured",
      domain,
      message: "URL saved. Public host is not connected yet.",
    };
  }

  try {
    const app = await coolifyApi<{ fqdn?: string }>(
      config,
      "GET",
      `/applications/${config.applicationUuid}`
    );
    const domains = parseDomains(app.fqdn);
    if (domains.includes(domain)) {
      return {
        synced: true,
        domain,
        added: false,
        restarted: false,
        message: `${domain} is connected.`,
      };
    }

    domains.push(domain);
    await coolifyApi(config, "PATCH", `/applications/${config.applicationUuid}`, {
      domains: domains.join(","),
      instant_deploy: false,
    });
    scheduleRestart(config);
    return {
      synced: true,
      domain,
      added: true,
      restarted: true,
      message: `${domain} is connecting. It is usually live within a minute.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logError("coolify.tracking-domain.sync", { domain, message });
    return {
      synced: false,
      reason: "coolify_error",
      domain,
      message: "URL saved. Could not connect the public address. Try again in a moment.",
    };
  }
}
