#!/usr/bin/env node
/**
 * Billing release guard. Fails when a tree contains billing code that can grant
 * paid access without a verified, captured payment (audit F-01, F-02, F-06, F-07,
 * F-11), or lacks the hardening this release depends on.
 *
 *   node scripts/ci/billing-guard.mjs              # check the working tree
 *   node scripts/ci/billing-guard.mjs --ref <sha>  # check a commit before deploying it
 *
 * Exit code 0 = safe to deploy, 1 = blocked. Prints rule ids only (no secrets).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_MIGRATION = "supabase/migrations/20261101100000_billing_p0_hardening.sql";

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) return null;
  const next = source.indexOf("\nexport ", start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

const SUBSCRIPTION_PLAN_OR_STATUS_WRITE =
  /\.from\(\s*["']subscriptions["']\s*\)\s*\.(?:update|insert|upsert)\(\s*\{[^}]{0,800}?(?<![\w])(?:plan_id|status)\s*:/;

/**
 * @param {(relativePath: string) => string | null} read file reader for the tree
 * @returns {{ id: string, message: string }[]} violations
 */
export function checkBillingTree(read) {
  const violations = [];
  const fail = (id, message) => violations.push({ id, message });

  const subscriptions = read("modules/billing/subscriptions.ts");
  if (!subscriptions) {
    fail("missing-subscriptions", "modules/billing/subscriptions.ts not found");
    return violations;
  }

  const startCheckout = functionBody(subscriptions, "startCheckout");
  if (!startCheckout) fail("missing-start-checkout", "startCheckout not found");
  else {
    if (SUBSCRIPTION_PLAN_OR_STATUS_WRITE.test(startCheckout) || /checkoutPatch/.test(startCheckout)) {
      fail("F-01", "startCheckout writes plan or status to subscriptions before payment");
    }
    if (!/payment_purpose:\s*["']subscription["']/.test(startCheckout) || !/status:\s*["']PENDING["']/.test(startCheckout)) {
      fail("F-01-intent", "startCheckout must create a PENDING subscription purchase intent");
    }
  }

  const resume = functionBody(subscriptions, "resumeSubscription");
  if (!resume) fail("missing-resume", "resumeSubscription not found");
  else if (/["']ACTIVE["']/.test(resume) || SUBSCRIPTION_PLAN_OR_STATUS_WRITE.test(resume)) {
    fail("F-02", "resumeSubscription can set ACTIVE or change status without a payment");
  }

  const changePlan = functionBody(subscriptions, "changePlan");
  if (changePlan && /\.update\(\s*\{[^}]{0,400}?(?<![\w])plan_id\s*:/.test(changePlan)) {
    fail("F-01-change-plan", "changePlan writes plan_id directly (upgrades must go through checkout)");
  }

  const verify = functionBody(subscriptions, "verifyCheckout");
  if (!verify) fail("missing-verify", "verifyCheckout not found");
  else {
    if (/["']authorized["']/.test(verify)) fail("F-11", "verifyCheckout accepts authorized (uncaptured) payments");
    if (!/fulfillCapturedSubscriptionPurchase/.test(verify)) {
      fail("verify-rpc", "verifyCheckout must activate only through fulfillCapturedSubscriptionPurchase");
    }
  }

  const purchase = read("modules/billing/purchase.ts");
  if (!purchase || !/PURCHASE_INTENT_STATUSES/.test(purchase)) {
    fail("F-06", "purchase intents must exclude FAILED attempt rows (PURCHASE_INTENT_STATUSES)");
  }

  const webhooks = read("modules/billing/webhooks.ts") ?? "";
  const failedBlock = webhooks.slice(webhooks.indexOf('event === "payment.failed"'), webhooks.indexOf('event === "subscription.halted"'));
  if (!/recordPaymentAttempt/.test(failedBlock)) {
    fail("F-06-webhook", "payment.failed must record an attempt instead of inserting a payments row");
  }

  const route = read("app/api/webhooks/razorpay/route.ts") ?? "";
  if (!/claimWebhookEvent/.test(route)) fail("F-07", "webhook route must claim events so failed events are retried");
  if (!/verifyWebhookSignature/.test(route)) fail("webhook-signature", "webhook route must verify the signature");

  const entitlements = read("modules/billing/entitlements.ts") ?? "";
  const assertFeature = functionBody(entitlements, "assertPlanFeature") ?? "";
  if (!/entitled/.test(assertFeature)) fail("F-05", "assertPlanFeature must refuse paid features after coverage ends");

  const checkoutButton = read("components/billing/checkout-button.tsx") ?? "";
  const dismiss = checkoutButton.slice(checkoutButton.indexOf("ondismiss"), checkoutButton.indexOf("handler:"));
  if (/billing\/(verify|subscribe|resume|change-plan)/.test(dismiss)) {
    fail("dismiss", "Checkout dismissal must not call billing mutations");
  }

  if (read(REQUIRED_MIGRATION) === null) fail("migration", `${REQUIRED_MIGRATION} is missing`);

  return violations;
}

function readerForWorkingTree(root) {
  return (relative) => {
    const file = path.join(root, relative);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
}

function readerForRef(root, ref) {
  return (relative) => {
    try {
      return execFileSync("git", ["show", `${ref}:${relative}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString();
    } catch {
      return null;
    }
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const refIndex = process.argv.indexOf("--ref");
  const ref = refIndex > 0 ? process.argv[refIndex + 1] : null;
  const violations = checkBillingTree(ref ? readerForRef(root, ref) : readerForWorkingTree(root));
  const label = ref ? `ref ${ref}` : "working tree";
  if (violations.length) {
    console.error(`billing-guard: BLOCKED (${label})`);
    for (const violation of violations) console.error(`  [${violation.id}] ${violation.message}`);
    process.exit(1);
  }
  console.log(`billing-guard: OK (${label})`);
}
