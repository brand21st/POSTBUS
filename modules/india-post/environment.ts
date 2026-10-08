import type { ProviderEnvironment } from "@/types/domain";

const PRODUCTION_HOSTS = new Set(["app.indiapost.gov.in"]);
const SANDBOX_HOSTS = new Set(["test.cept.gov.in"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function indiaPostHostname(configured: string) {
  const raw = configured.trim();
  if (!raw) {
    throw Object.assign(new Error("India Post base URL is missing."), { code: "INDIA_POST_ENV_ISOLATION" });
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    throw Object.assign(new Error("India Post base URL is invalid."), { code: "INDIA_POST_ENV_ISOLATION" });
  }
}

function isLocalHost(host: string) {
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

/**
 * Fail closed: UAT/Sandbox must never hit a production CEPT host,
 * and PRODUCTION must never silently use the sandbox host.
 * Localhost is allowed only for isolated staging stubs.
 */
export function assertIndiaPostEnvironmentUrl(environment: ProviderEnvironment, configured: string) {
  const host = indiaPostHostname(configured);
  const productionHost = PRODUCTION_HOSTS.has(host);
  const sandboxHost = SANDBOX_HOSTS.has(host);
  const local = isLocalHost(host);

  if (environment === "UAT") {
    if (productionHost) {
      throw Object.assign(
        new Error("India Post Sandbox/UAT cannot use a production CEPT endpoint."),
        { code: "INDIA_POST_ENV_ISOLATION" }
      );
    }
    if (!sandboxHost && !local) {
      throw Object.assign(
        new Error("India Post Sandbox/UAT endpoint is not an allowed sandbox host."),
        { code: "INDIA_POST_ENV_ISOLATION" }
      );
    }
    return host;
  }

  if (sandboxHost) {
    throw Object.assign(
      new Error("India Post PRODUCTION cannot use the sandbox CEPT endpoint."),
      { code: "INDIA_POST_ENV_ISOLATION" }
    );
  }
  if (!productionHost && !local) {
    throw Object.assign(
      new Error("India Post PRODUCTION endpoint is not an allowed production host."),
      { code: "INDIA_POST_ENV_ISOLATION" }
    );
  }
  return host;
}

export function indiaPostResolvedBaseUrl(
  environment: ProviderEnvironment,
  uatBaseUrl: string,
  prodBaseUrl: string
) {
  const configured = environment === "PRODUCTION" ? prodBaseUrl : uatBaseUrl;
  assertIndiaPostEnvironmentUrl(environment, configured);
  return configured;
}
