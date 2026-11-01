import {
  PRODUCTION_SUPABASE_REF,
  assertNonProductionMutationTarget,
  supabaseProjectRefFromUrl,
} from "@/lib/env/staging-isolation";

export const SHOPIFY_DEV_PROJECT_NAME = "postbus-shopify-dev";
/** Hosted Shopify cloud-dev project. Never the production PostBus ref. */
export const SHOPIFY_DEV_PROJECT_REF = "faanzcrnfndttbjpmlxu";

const PRODUCTION_MARKERS = [
  PRODUCTION_SUPABASE_REF,
  "www.postbus.in",
];

function blob(vars: Record<string, string | undefined>) {
  return [
    vars.NEXT_PUBLIC_SUPABASE_URL,
    vars.SUPABASE_URL,
    vars.DATABASE_URL,
    vars.SUPABASE_DB_URL,
    vars.DIRECT_URL,
    vars.POSTGRES_URL,
    vars.POSTGRES_PRISMA_URL,
    vars.POSTGRES_URL_NON_POOLING,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function parseJobRunner(raw?: string | null): "redis" | "database" | "none" {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "redis") return "redis";
  if (value === "none" || value === "off" || value === "disabled") return "none";
  return "database";
}

export function assertShopifyDevAdminTarget(input: {
  supabaseUrl?: string | null;
  databaseUrl?: string | null;
}) {
  if ((process.env.POSTBUS_SHOPIFY_DEV || "").trim().toLowerCase() !== "true") {
    return;
  }
  assertShopifyDevRuntimeEnv({
    POSTBUS_SHOPIFY_DEV: "true",
    POSTBUS_SHOPIFY_DEV_PROJECT_REF: process.env.POSTBUS_SHOPIFY_DEV_PROJECT_REF,
    NEXT_PUBLIC_SUPABASE_URL: input.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL,
    DATABASE_URL: input.databaseUrl || process.env.DATABASE_URL,
    JOB_RUNNER: process.env.JOB_RUNNER,
    SHOPIFY_EMBEDDED_APP_ENABLED: process.env.SHOPIFY_EMBEDDED_APP_ENABLED,
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    INTEGRATION_ENCRYPTION_KEY: process.env.INTEGRATION_ENCRYPTION_KEY,
  });
}

/** Runtime for npm run dev:shopify. Does not authorize remote SQL. */
export function assertShopifyDevRuntimeEnv(vars: Record<string, string | undefined>) {
  if ((vars.POSTBUS_SHOPIFY_DEV || "").trim().toLowerCase() !== "true") {
    throw new Error("STOP: Shopify cloud-dev requires POSTBUS_SHOPIFY_DEV=true. Refusing production fallback.");
  }

  const supabaseUrl = (vars.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!supabaseUrl) {
    throw new Error("STOP: .env.shopify-local is missing NEXT_PUBLIC_SUPABASE_URL. Refusing to fall back to production.");
  }

  const lowered = supabaseUrl.toLowerCase();
  if (lowered.includes("127.0.0.1") || lowered.includes("localhost")) {
    throw new Error("STOP: Shopify cloud-dev requires a hosted postbus-shopify-dev project, not loopback Docker.");
  }

  assertNonProductionMutationTarget({
    supabaseUrl,
    databaseUrl: blob(vars),
    operation: "shopify-dev runtime",
  });

  const combined = blob(vars);
  for (const marker of PRODUCTION_MARKERS) {
    if (combined.includes(marker.toLowerCase())) {
      throw new Error("STOP: Shopify cloud-dev connection blob contains a production identity.");
    }
  }

  const projectRef = supabaseProjectRefFromUrl(supabaseUrl);
  const approved = (vars.POSTBUS_SHOPIFY_DEV_PROJECT_REF ?? "").trim().toLowerCase();
  if (!approved) {
    throw new Error("STOP: hosted Shopify cloud-dev requires POSTBUS_SHOPIFY_DEV_PROJECT_REF allowlist.");
  }
  if (approved === PRODUCTION_SUPABASE_REF) {
    throw new Error("STOP: POSTBUS_SHOPIFY_DEV_PROJECT_REF cannot be the production project.");
  }
  if (approved !== SHOPIFY_DEV_PROJECT_REF) {
    throw new Error("STOP: POSTBUS_SHOPIFY_DEV_PROJECT_REF must be the postbus-shopify-dev project.");
  }
  if (!projectRef) {
    throw new Error("STOP: NEXT_PUBLIC_SUPABASE_URL must be https://<ref>.supabase.co for postbus-shopify-dev.");
  }
  if (projectRef !== approved) {
    throw new Error("STOP: NEXT_PUBLIC_SUPABASE_URL does not match POSTBUS_SHOPIFY_DEV_PROJECT_REF.");
  }

  if (!(vars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim() || !(vars.SUPABASE_SERVICE_ROLE_KEY || "").trim()) {
    throw new Error("STOP: Shopify cloud-dev requires anon and service-role keys from postbus-shopify-dev only.");
  }

  const encryptionKey = (vars.INTEGRATION_ENCRYPTION_KEY || "").trim();
  if (encryptionKey.length < 32 || encryptionKey === "dev-only-change-me-32-bytes-min!!") {
    throw new Error(
      "STOP: Shopify cloud-dev requires a dedicated INTEGRATION_ENCRYPTION_KEY (32+ chars, not the code fallback)."
    );
  }

  if (parseJobRunner(vars.JOB_RUNNER) !== "none") {
    throw new Error("STOP: Shopify cloud-dev requires JOB_RUNNER=none so Next cannot drain background_jobs.");
  }

  // app/shopify/layout.tsx 404s without this flag, so the dev runtime must turn it on.
  if ((vars.SHOPIFY_EMBEDDED_APP_ENABLED || "").trim().toLowerCase() !== "true") {
    throw new Error("STOP: Shopify cloud-dev requires SHOPIFY_EMBEDDED_APP_ENABLED=true to render the embedded app.");
  }

  if ((vars.SHOPIFY_API_KEY || vars.SHOPIFY_API_SECRET || "").trim()) {
    throw new Error("STOP: Shopify cloud-dev refuses SHOPIFY_API_KEY/SECRET (BYO). Use public-app credentials only.");
  }

  const razorpay = (vars.RAZORPAY_KEY_ID || vars.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").trim();
  if (razorpay.startsWith("rzp_live_")) {
    throw new Error("STOP: Shopify cloud-dev refuses a live Razorpay key.");
  }

  return { supabaseUrl, projectRef, projectName: SHOPIFY_DEV_PROJECT_NAME };
}

export const SHOPIFY_DEV_PARENT_ENV_BLOCKLIST = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "VACHAT_API_KEY",
  "JOB_RUNNER",
  "CRON_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
] as const;
