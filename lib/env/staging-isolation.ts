/** Production GoTrue project. Staging Auth must never use this reference. */
export const PRODUCTION_SUPABASE_REF = "hgacoeoovjxkzfbesmvl";

/** Production Coolify web application. Staging must use a different UUID. */
export const PRODUCTION_COOLIFY_APPLICATION_UUID = "mw9larpomkyonxzy1rk3h6jm";

export function isStagingAuthMode(input: { mode?: string; appUrl?: string }) {
  const mode = (input.mode ?? "").trim().toLowerCase();
  if (mode === "staging" || mode === "auth-staging") return true;
  const appUrl = (input.appUrl ?? "").toLowerCase();
  return appUrl.includes("auth-staging.postbus.in");
}

/** Mutating affiliate/billing tests must name a non-production target before any write. */
export function supabaseProjectRefFromUrl(supabaseUrl?: string | null) {
  const value = (supabaseUrl ?? "").trim();
  if (!value) return "";
  try {
    const host = new URL(value).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

export function parseDotEnvFile(text: string) {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  return map;
}

/** Runtime for npm run dev:staging. Does not authorize remote SQL. */
export function assertStagingRuntimeEnv(vars: Record<string, string | undefined>) {
  const supabaseUrl = (vars.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!supabaseUrl) {
    throw new Error("STOP: .env.staging.local is missing NEXT_PUBLIC_SUPABASE_URL. Refusing to fall back to production.");
  }
  assertNonProductionMutationTarget({ supabaseUrl, operation: "staging runtime" });
  const razorpay = (vars.RAZORPAY_KEY_ID || vars.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").trim();
  if (razorpay.startsWith("rzp_live_")) {
    throw new Error("STOP: staging runtime refuses a live Razorpay key.");
  }
  if ((vars.POSTBUS_AFFILIATE_PAYOUTS_ENABLED || "").trim() === "true") {
    throw new Error("STOP: staging runtime refuses payouts.");
  }
  if ((vars.POSTBUS_BILLING_TAX_INVOICE_ENABLED || "").trim() === "true") {
    throw new Error("STOP: staging runtime refuses tax invoice issuance.");
  }
  assertLocalStagingProviderIsolation(vars);
  const projectRef = supabaseProjectRefFromUrl(supabaseUrl);
  const approved = (vars.POSTBUS_STAGING_PROJECT_REF ?? "").trim().toLowerCase();
  if (approved) {
    if (approved === PRODUCTION_SUPABASE_REF) {
      throw new Error("STOP: POSTBUS_STAGING_PROJECT_REF cannot be the production project.");
    }
    if (projectRef && projectRef !== approved) {
      throw new Error("STOP: NEXT_PUBLIC_SUPABASE_URL does not match POSTBUS_STAGING_PROJECT_REF.");
    }
  } else if (projectRef) {
    throw new Error("STOP: hosted Supabase staging requires POSTBUS_STAGING_PROJECT_REF allowlist.");
  }
  return { supabaseUrl, projectRef };
}

const LIVE_INDIA_POST_HOSTS = ["indiapost.gov.in", "cept.gov.in", "test.cept.gov.in"];

/** Local Patch 1 staging must never resolve CEPT or Shopify to production hosts. */
export function assertLocalStagingProviderIsolation(vars: Record<string, string | undefined>) {
  const indiaPost = `${vars.INDIA_POST_UAT_BASE_URL ?? ""} ${vars.INDIA_POST_PROD_BASE_URL ?? ""}`.toLowerCase();
  for (const host of LIVE_INDIA_POST_HOSTS) {
    if (indiaPost.includes(host)) {
      throw new Error("STOP: staging runtime refuses live India Post hosts.");
    }
  }
  const stagingNamed = (vars.POSTBUS_ENV || "").trim().toLowerCase() === "staging";
  if (stagingNamed) {
    const uat = (vars.INDIA_POST_UAT_BASE_URL || "").trim();
    const prod = (vars.INDIA_POST_PROD_BASE_URL || "").trim();
    if (!uat || !prod) {
      throw new Error("STOP: POSTBUS_ENV=staging requires INDIA_POST_UAT_BASE_URL and INDIA_POST_PROD_BASE_URL.");
    }
    const allowed = new Set(
      ["127.0.0.1", "localhost", "::1"].concat(
        (vars.INDIA_POST_STAGING_ALLOWED_HOSTS || "")
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const hostOf = (value: string) => {
      try {
        return new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`).hostname.toLowerCase();
      } catch {
        return "";
      }
    };
    for (const value of [uat, prod]) {
      const host = hostOf(value);
      if (!host || (!allowed.has(host) && !host.endsWith(".localhost"))) {
        throw new Error("STOP: POSTBUS_ENV=staging India Post host is not on the staging allowlist.");
      }
    }
    if ((vars.SHOPIFY_API_KEY || vars.SHOPIFY_API_SECRET || "").trim()) {
      throw new Error("STOP: staging runtime refuses SHOPIFY_API_KEY/SECRET. Leave them empty.");
    }
    if ((vars.VACHAT_API_KEY || "").trim()) {
      throw new Error("STOP: staging runtime refuses VACHAT_API_KEY.");
    }
  }
}

export function assertNonProductionMutationTarget(input: {
  supabaseUrl?: string | null;
  databaseUrl?: string | null;
  operation?: string | null;
}) {
  const blob = `${input.supabaseUrl ?? ""} ${input.databaseUrl ?? ""}`.toLowerCase();
  if (!blob.trim()) {
    throw new Error("STOP: mutation target identity is unknown.");
  }
  if (blob.includes(PRODUCTION_SUPABASE_REF) || (blob.includes("postbus.in") && !blob.includes("auth-staging") && !blob.includes("127.0.0.1") && !blob.includes("localhost"))) {
    throw new Error(`STOP: refusing ${input.operation || "write"} against production.`);
  }
}

export function assertStagingAuthIsolation(input: {
  mode?: string;
  supabaseUrl?: string;
  appUrl?: string;
}) {
  if (!isStagingAuthMode(input)) return;

  const supabaseUrl = (input.supabaseUrl ?? "").trim().toLowerCase();
  if (!supabaseUrl) {
    throw new Error("Staging authentication requires NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (supabaseUrl.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error(
      "STOP: staging Auth is pointing at the production Supabase project. Refusing to start."
    );
  }
  if (supabaseUrl.includes("postbus.in") && !supabaseUrl.includes("auth-staging")) {
    throw new Error("STOP: staging Auth URL looks like a production PostBus host.");
  }
}

/** Stage B hosted provisioning gate. Does not create infrastructure. */
export function assertHostedStagingProvisioningTarget(vars: Record<string, string | undefined>) {
  const identity = assertStagingRuntimeEnv(vars);
  const coolifyUuid = (vars.COOLIFY_APPLICATION_UUID || "").trim();
  if (coolifyUuid && coolifyUuid === PRODUCTION_COOLIFY_APPLICATION_UUID) {
    throw new Error("STOP: refusing the production Coolify application UUID as a staging target.");
  }
  const appUrl = (vars.NEXT_PUBLIC_APP_URL || "").toLowerCase();
  if (appUrl.includes("www.postbus.in") && !appUrl.includes("auth-staging") && !appUrl.includes("staging.")) {
    throw new Error("STOP: staging APP URL cannot be the production website.");
  }
  if (!identity.projectRef && !(vars.NEXT_PUBLIC_SUPABASE_URL || "").includes("127.0.0.1")) {
    throw new Error("STOP: hosted staging needs an approved non-production Supabase project ref.");
  }
  return identity;
}
