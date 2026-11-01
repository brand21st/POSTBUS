import { assertOrganizationMatch, createShopifyTenantAdmin } from "@/lib/shopify-app/tenant-admin";
import { startInstallBackfillOnce } from "@/lib/shopify-app/backfill";
import type { ShopifyAppContext } from "@/lib/shopify-app/context";

export type ShopifyBootstrapPayload = {
  shopDomain: string;
  installationStatus: string;
  organization: { id: string; ready: boolean };
  indiaPost: { configured: boolean; status: string | null };
  shippingReadiness: "connected" | "setup_required" | "provisioning" | "authorization_required" | "error";
  nextSteps: { id: string; label: string; status: "complete" | "current" | "upcoming" }[];
  shopifyUserId: string | null;
};

export async function buildShopifyBootstrap(
  ctx: ShopifyAppContext,
  requestedOrganizationId?: string | null
): Promise<ShopifyBootstrapPayload> {
  assertOrganizationMatch(ctx.organizationId, requestedOrganizationId);
  const tenant = createShopifyTenantAdmin(ctx.organizationId);
  await startInstallBackfillOnce(ctx);

  const { data: connection } = await tenant
    .from("india_post_connections")
    .select("status")
    .maybeSingle();

  const indiaConfigured = String(connection?.status ?? "").toUpperCase() === "CONNECTED";
  const install = ctx.installationStatus.toUpperCase();

  let shippingReadiness: ShopifyBootstrapPayload["shippingReadiness"] = "setup_required";
  if (install === "DISCONNECTED" || install === "REAUTH_REQUIRED") shippingReadiness = "authorization_required";
  else if (install === "ERROR") shippingReadiness = "error";
  else if (install === "PENDING") shippingReadiness = "provisioning";
  else if (indiaConfigured) shippingReadiness = "connected";

  const nextSteps: ShopifyBootstrapPayload["nextSteps"] = [
    { id: "shopify", label: "Shopify installation verified", status: "complete" },
    {
      id: "organization",
      label: "PostBus organization ready",
      status: ctx.organizationId ? "complete" : "current",
    },
    {
      id: "india-post",
      label: "Connect India Post account",
      status: "upcoming",
    },
    { id: "shipping", label: "Configure shipping settings", status: "upcoming" },
    { id: "ready", label: "Ready for shipping", status: "upcoming" },
  ];

  return {
    shopDomain: ctx.shopDomain,
    installationStatus: ctx.installationStatus,
    organization: { id: ctx.organizationId, ready: Boolean(ctx.organizationId) },
    indiaPost: {
      configured: indiaConfigured,
      status: connection?.status ? String(connection.status) : null,
    },
    shippingReadiness,
    nextSteps,
    shopifyUserId: ctx.shopifyUserId,
  };
}
