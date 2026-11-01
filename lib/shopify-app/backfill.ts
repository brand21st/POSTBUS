import { logError, logInfo } from "@/lib/logger";
import type { ShopifyAppContext } from "@/lib/shopify-app/context";
import { createAdminClient } from "@/lib/supabase/admin";

export type InstallBackfillDeps = {
  /** Atomically sets backfill_started_at if still null; true only for the caller that set it. */
  claim: (installationId: string, organizationId: string) => Promise<boolean>;
  release: (installationId: string, organizationId: string) => Promise<void>;
  enqueue: (organizationId: string) => Promise<{ queued: boolean }>;
};

function defaultDeps(): InstallBackfillDeps {
  const admin = createAdminClient();
  return {
    async claim(installationId, organizationId) {
      const { data, error } = await admin
        .from("shopify_app_installations")
        .update({ backfill_started_at: new Date().toISOString() })
        .eq("id", installationId)
        .eq("organization_id", organizationId)
        .is("backfill_started_at", null)
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },
    async release(installationId, organizationId) {
      await admin
        .from("shopify_app_installations")
        .update({ backfill_started_at: null })
        .eq("id", installationId)
        .eq("organization_id", organizationId);
    },
    async enqueue(organizationId) {
      // Lazy: the Shopify order module is large and bootstrap runs on every app open.
      const [{ enqueueShopifyOrderSync }, { appOrderBackfillSince }] = await Promise.all([
        import("@/modules/shopify/sync-job"),
        import("@/modules/shopify/orders"),
      ]);
      return enqueueShopifyOrderSync(admin, { organizationId, force: true, since: appOrderBackfillSince() });
    },
  };
}

/**
 * The first time a connected shop opens the app, queue one import of its last 60 days of unfulfilled
 * orders. Never throws: bootstrap must render even if the queue is unavailable (the next open retries).
 */
export async function startInstallBackfillOnce(
  ctx: Pick<ShopifyAppContext, "installationId" | "organizationId" | "installationStatus" | "shopDomain">,
  deps: InstallBackfillDeps = defaultDeps()
) {
  if (ctx.installationStatus !== "CONNECTED") return { started: false };
  try {
    if (!(await deps.claim(ctx.installationId, ctx.organizationId))) return { started: false };
  } catch (error) {
    logError("shopify_app.backfill.claim_failed", {
      shopDomain: ctx.shopDomain,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { started: false };
  }
  try {
    const result = await deps.enqueue(ctx.organizationId);
    if (!result.queued) throw new Error("Order import was not queued.");
    logInfo("shopify_app.backfill.queued", { shopDomain: ctx.shopDomain, organizationId: ctx.organizationId });
    return { started: true };
  } catch (error) {
    await deps.release(ctx.installationId, ctx.organizationId).catch(() => undefined);
    logError("shopify_app.backfill.enqueue_failed", {
      shopDomain: ctx.shopDomain,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { started: false };
  }
}
