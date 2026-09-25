import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { PLAN_FEATURE_OPTIONS } from "@/modules/billing/plan-features";
import {
  getLiveSubscription,
  mapPlan,
  type PlanRow,
} from "@/modules/billing/subscriptions";

export const FEATURE = {
  shopify: "Shopify order sync",
  shipments: "Shipment workspace",
  labels: "Label and barcode workflows",
  starterBundle: "Everything in Starter",
  bulk: "Bulk shipping tools",
  automation: "Automation rules",
  manifests: "Manifest management",
  invoices: "Invoices",
  trackingPage: "Tracking page",
  analytics: "Analytics",
  proBundle: "Everything in Pro",
  support: "Priority support",
  wati: "WhatsApp (Wati) notifications",
  indiaPost: "India Post booking",
  packing: "Custom packing labels",
} as const;

export type PlanFeatureName = (typeof PLAN_FEATURE_OPTIONS)[number];

export const STARTER_FEATURES: PlanFeatureName[] = [
  FEATURE.shopify,
  FEATURE.shipments,
  FEATURE.labels,
  FEATURE.indiaPost,
];

export const PRO_FEATURES: PlanFeatureName[] = [
  ...STARTER_FEATURES,
  FEATURE.bulk,
  FEATURE.automation,
  FEATURE.manifests,
  FEATURE.invoices,
  FEATURE.trackingPage,
  FEATURE.analytics,
];

export const BUSINESS_FEATURES: PlanFeatureName[] = [
  ...PRO_FEATURES,
  FEATURE.support,
  FEATURE.wati,
  FEATURE.packing,
];

export const UPGRADE_PLAN_MESSAGE = "This feature is on a higher plan. Upgrade to continue.";

const NAV_FEATURES: Array<{ href: string; feature: string }> = [
  { href: "/dashboard/analytics", feature: FEATURE.analytics },
  { href: "/dashboard/invoices", feature: FEATURE.invoices },
  { href: "/dashboard/tracking", feature: FEATURE.trackingPage },
  { href: "/dashboard/manifests", feature: FEATURE.manifests },
  { href: "/dashboard/labels/customize", feature: FEATURE.packing },
  { href: "/dashboard/integrations/wati", feature: FEATURE.wati },
  { href: "/dashboard/integrations/india-post", feature: FEATURE.indiaPost },
  { href: "/dashboard/integrations/shopify", feature: FEATURE.shopify },
];

function asPlan(value: PlanRow | PlanRow[] | null | undefined): PlanRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function canonicalFeaturesForSlug(slug?: string | null): PlanFeatureName[] | null {
  const key = (slug ?? "").toLowerCase();
  if (key === "starter") return STARTER_FEATURES;
  if (key === "pro") return PRO_FEATURES;
  if (key === "business") return BUSINESS_FEATURES;
  return null;
}

export function expandPlanFeatures(
  features: string[] | null | undefined,
  input?: { trial?: boolean; slug?: string | null }
): string[] {
  if (input?.trial) return [...BUSINESS_FEATURES];
  const canonical = canonicalFeaturesForSlug(input?.slug);
  if (canonical) return [...canonical];
  const listed = (features ?? []).map((line) => line.trim()).filter(Boolean);
  const allowed = new Set<string>(listed);
  if (listed.includes("Operational analytics")) allowed.add(FEATURE.analytics);
  if (listed.includes(FEATURE.starterBundle)) STARTER_FEATURES.forEach((item) => allowed.add(item));
  if (listed.includes(FEATURE.proBundle)) PRO_FEATURES.forEach((item) => allowed.add(item));
  return [...allowed];
}

export function hasPlanFeature(features: string[] | null | undefined, feature: string) {
  return (features ?? []).includes(feature);
}

export function automationToggleLock(camel: string, allows: (feature: string) => boolean): string | null {
  if (!allows(FEATURE.automation)) return FEATURE.automation;
  if (camel.startsWith("autoWati") && !allows(FEATURE.wati)) return FEATURE.wati;
  if (camel === "autoManifest" && !allows(FEATURE.manifests)) return FEATURE.manifests;
  if ((camel === "autoShopifySync" || camel === "autoShopifyFulfillment") && !allows(FEATURE.shopify)) {
    return FEATURE.shopify;
  }
  if (
    (camel === "autoBooking" || camel === "autoTrackingSync" || camel === "autoLabelGeneration") &&
    !allows(FEATURE.indiaPost)
  ) {
    return FEATURE.indiaPost;
  }
  return null;
}

export function lockedFeatureForPath(pathname: string): string | null {
  const match = NAV_FEATURES.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return match?.feature ?? null;
}

export function lockedFeatureForApi(method: string, path: string, slugs: string[]): string | null {
  if (path === "dashboard/analytics" || (slugs[0] === "dashboard" && slugs[1] === "analytics")) {
    return FEATURE.analytics;
  }
  if (slugs[0] === "invoices" || slugs[0] === "invoice-template") return FEATURE.invoices;
  if (slugs[0] === "tracking" || slugs[0] === "tracking-pages") return FEATURE.trackingPage;
  if (slugs[0] === "automation" && method !== "GET") return FEATURE.automation;
  if (slugs[0] === "manifests" && method !== "GET") return FEATURE.manifests;
  if (slugs[0] === "label-template" && method !== "GET") return FEATURE.packing;
  if (path === "labels/bulk-download" || (slugs[0] === "labels" && slugs[1] === "bulk-download")) return FEATURE.bulk;
  if (path === "orders/bulk/status") return FEATURE.bulk;
  if (slugs[0] === "integrations") {
    if (slugs[1] === "shopify" && method !== "GET") return FEATURE.shopify;
    if (slugs[1] === "wati" && method !== "GET") return FEATURE.wati;
    if (slugs[1] === "india-post" && method !== "GET") return FEATURE.indiaPost;
  }
  return null;
}

export type PlanEntitlements = {
  features: string[];
  trial: boolean;
  planName: string | null;
  planSlug: string | null;
  status: string | null;
};

export async function getOrganizationEntitlements(
  supabase: SupabaseClient,
  organizationId: string
): Promise<PlanEntitlements> {
  const live = await getLiveSubscription(supabase, organizationId);
  const plan = asPlan(live?.plans);
  const mapped = plan ? mapPlan(plan) : null;
  const trial = live?.status === "TRIAL";
  return {
    features: expandPlanFeatures(mapped?.features ?? [], {
      trial,
      slug: mapped?.slug,
    }),
    trial,
    planName: mapped?.name ?? null,
    planSlug: mapped?.slug ?? null,
    status: live?.status ?? null,
  };
}

export async function assertPlanFeature(
  supabase: SupabaseClient,
  organizationId: string,
  feature: string
) {
  const entitlements = await getOrganizationEntitlements(supabase, organizationId);
  if (hasPlanFeature(entitlements.features, feature)) return entitlements;
  throw new AppError(ERROR_CODES.FORBIDDEN, UPGRADE_PLAN_MESSAGE, { feature });
}
