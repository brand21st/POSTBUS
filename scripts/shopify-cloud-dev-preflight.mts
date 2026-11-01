/**
 * Masked read-only inspection of Shopify cloud-dev overlay and sibling env files.
 * Never prints secret values. Does not migrate, link, or call production APIs with keys.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { PRODUCTION_SUPABASE_REF, parseDotEnvFile, supabaseProjectRefFromUrl } from "../lib/env/staging-isolation.ts";
import {
  SHOPIFY_DEV_PROJECT_REF,
  assertShopifyDevRuntimeEnv,
  parseJobRunner,
} from "../lib/env/shopify-dev-isolation.ts";

const DEV_REF = SHOPIFY_DEV_PROJECT_REF;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function classifyKey(value: string) {
  const v = value.trim();
  if (!v) return { kind: "empty" as const, jwt: null as null | Record<string, string> };
  if (v.startsWith("sb_secret_")) return { kind: "sb_secret" as const, jwt: null };
  if (v.startsWith("sb_publishable_")) return { kind: "sb_publishable" as const, jwt: null };
  if (v.startsWith("sb_")) return { kind: "sb_other" as const, jwt: null };
  const parts = v.split(".");
  if (parts.length === 3 && parts[0].startsWith("eyJ")) {
    try {
      const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
      const ref = typeof json.ref === "string" ? json.ref : "";
      const role = typeof json.role === "string" ? json.role : "";
      const iss = typeof json.iss === "string" ? json.iss : "";
      return {
        kind: "legacy_jwt" as const,
        jwt: {
          role,
          ref,
          issHost: hostOf(iss),
          iat: typeof json.iat === "number" ? String(json.iat) : "",
          isProductionRef: ref === PRODUCTION_SUPABASE_REF,
          isShopifyDevRef: ref === DEV_REF,
        },
      };
    } catch {
      return { kind: "unparseable" as const, jwt: null };
    }
  }
  return { kind: "unknown" as const, jwt: null };
}

function fingerprint(value: string) {
  if (!value.trim()) return "(empty)";
  return createHash("sha256").update(value.trim(), "utf8").digest("hex").slice(0, 12);
}

function loadEnv(path: string) {
  if (!existsSync(path)) return null;
  return Object.fromEntries(parseDotEnvFile(readFileSync(path, "utf8")));
}

function inspectFile(path: string) {
  const vars = loadEnv(path);
  if (!vars) return { exists: false as const };
  const url = vars.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = classifyKey(vars.SUPABASE_SERVICE_ROLE_KEY || "");
  const anon = classifyKey(vars.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  const razorpay = (vars.RAZORPAY_KEY_ID || vars.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").trim();
  return {
    exists: true as const,
    supabaseHost: hostOf(url) || "(missing)",
    supabaseProjectRef: supabaseProjectRefFromUrl(url) || "(none)",
    supabaseIsProductionRef: supabaseProjectRefFromUrl(url) === PRODUCTION_SUPABASE_REF,
    supabaseIsShopifyDevRef: supabaseProjectRefFromUrl(url) === DEV_REF,
    postbusShopifyDev: vars.POSTBUS_SHOPIFY_DEV || "",
    allowlistRef: vars.POSTBUS_SHOPIFY_DEV_PROJECT_REF || "",
    jobRunner: parseJobRunner(vars.JOB_RUNNER),
    jobRunnerRaw: vars.JOB_RUNNER || "(unset-defaults-database)",
    embeddedFlag: (vars.SHOPIFY_EMBEDDED_APP_ENABLED || "").toLowerCase() === "true",
    byoShopifyPresent: Boolean((vars.SHOPIFY_API_KEY || vars.SHOPIFY_API_SECRET || "").trim()),
    publicAppClientIdPresent: Boolean((vars.SHOPIFY_PUBLIC_APP_CLIENT_ID || "").trim()),
    publicAppSecretPresent: Boolean((vars.SHOPIFY_PUBLIC_APP_CLIENT_SECRET || "").trim()),
    liveRazorpay: razorpay.startsWith("rzp_live_"),
    encryptionKeyPresent: Boolean((vars.INTEGRATION_ENCRYPTION_KEY || "").trim()),
    encryptionKeyLength: (vars.INTEGRATION_ENCRYPTION_KEY || "").trim().length,
    serviceKeyKind: service.kind,
    serviceJwt: service.jwt,
    serviceFingerprint: fingerprint(vars.SUPABASE_SERVICE_ROLE_KEY || ""),
    anonKeyKind: anon.kind,
    anonJwt: anon.jwt,
    port: vars.PORT || "",
    appUrl: vars.NEXT_PUBLIC_APP_URL || "",
  };
}

/** Payload `iat` of the shopify-dev service_role JWT pasted in chat. Not a secret. */
const CHAT_EXPOSED_DEV_JWT_IAT = "1792474101";

const overlay = inspectFile(".env.shopify-local");
const local = inspectFile(".env.local");

let gate: { ok: boolean; message: string; projectRef?: string } = { ok: false, message: "overlay missing" };
if (overlay.exists) {
  const vars = loadEnv(".env.shopify-local")!;
  vars.POSTBUS_SHOPIFY_DEV = vars.POSTBUS_SHOPIFY_DEV || "true";
  vars.JOB_RUNNER = vars.JOB_RUNNER || "none";
  try {
    const identity = assertShopifyDevRuntimeEnv(vars);
    gate = { ok: true, message: "pass", projectRef: identity.projectRef };
  } catch (error) {
    gate = { ok: false, message: error instanceof Error ? error.message : "gate failed" };
  }
}

const chatExposedDevJwtStillInOverlay =
  overlay.exists &&
  overlay.serviceKeyKind === "legacy_jwt" &&
  overlay.serviceJwt?.isShopifyDevRef === true &&
  overlay.serviceJwt?.role === "service_role" &&
  overlay.serviceJwt?.iat === CHAT_EXPOSED_DEV_JWT_IAT;

const leakedProductionJwtInOverlay =
  overlay.exists && (overlay.serviceJwt?.isProductionRef || overlay.supabaseIsProductionRef);

async function probeShopifyDevServiceRole() {
  const vars = loadEnv(".env.shopify-local");
  const url = (vars?.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = (vars?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!vars || !url.includes(DEV_REF) || !key) {
    return { skipped: true, reason: "no shopify-dev overlay key" };
  }
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const unauthorized = response.status === 401 || response.status === 403;
  return {
    skipped: false,
    targetRef: DEV_REF,
    httpStatus: response.status,
    jwtAcceptedByHost: !unauthorized,
  };
}

const serviceProbe = await probeShopifyDevServiceRole();

const parentEnvWouldLeakProductionUrl = Boolean(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "").toLowerCase().includes(PRODUCTION_SUPABASE_REF)
);

process.stdout.write(
  `${JSON.stringify(
    {
      productionRefForbidden: PRODUCTION_SUPABASE_REF,
      shopifyDevRefExpected: DEV_REF,
      overlay,
      envLocal: local.exists
        ? {
            exists: true,
            supabaseProjectRef: local.supabaseProjectRef,
            supabaseIsProductionRef: local.supabaseIsProductionRef,
            jobRunner: local.jobRunner,
            embeddedFlag: local.embeddedFlag,
            serviceKeyKind: local.serviceKeyKind,
            serviceJwtRefIsProduction: local.serviceJwt?.isProductionRef ?? null,
            serviceJwtRefIsShopifyDev: local.serviceJwt?.isShopifyDevRef ?? null,
            serviceFingerprint: local.serviceFingerprint,
            sameServiceFingerprintAsOverlay:
              overlay.exists && local.serviceFingerprint === overlay.serviceFingerprint,
            encryptionKeyLength: local.encryptionKeyLength,
          }
        : { exists: false },
      gate,
      runner: {
        jobRunnerForced: "none",
        parentProductionUrlPresentInShell: parentEnvWouldLeakProductionUrl,
        overlayWinsAfterBlocklist: true,
        encryptionKeyOnBlocklist: true,
        embeddedFlag: overlay.exists ? overlay.embeddedFlag : null,
      },
      sbSecretSupportedBySdk: true,
      sbSecretConfigured: overlay.exists && overlay.serviceKeyKind === "sb_secret",
      sdkNote: "@supabase/supabase-js 2.116 sends sb_secret_/sb_publishable_ as apikey only (not Bearer)",
      leakedProductionJwtInOverlay: Boolean(leakedProductionJwtInOverlay),
      chatExposedDevJwtStillInOverlay,
      chatExposedDevJwtRevoked: chatExposedDevJwtStillInOverlay
        ? serviceProbe.skipped
          ? "UNVERIFIED"
          : serviceProbe.jwtAcceptedByHost
            ? false
            : true
        : overlay.exists && overlay.serviceKeyKind === "sb_secret"
          ? "REPLACED_WITH_SB_SECRET"
          : overlay.exists && overlay.serviceJwt?.iat && overlay.serviceJwt.iat !== CHAT_EXPOSED_DEV_JWT_IAT
            ? "IAT_CHANGED_NOT_PROOF_OF_REVOKE"
            : "UNVERIFIED",
      serviceRoleProbe: serviceProbe,
      dockerRequired: false,
    },
    null,
    2
  )}\n`
);
