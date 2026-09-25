import { describe, expect, it } from "vitest";
import {
  BUSINESS_FEATURES,
  FEATURE,
  PRO_FEATURES,
  STARTER_FEATURES,
  automationToggleLock,
  expandPlanFeatures,
  lockedFeatureForApi,
  lockedFeatureForPath,
} from "@/modules/billing/entitlements";

describe("plan entitlements", () => {
  it("uses catalog floors for starter, pro, and business slugs", () => {
    expect(expandPlanFeatures([FEATURE.analytics], { slug: "starter" })).toEqual(STARTER_FEATURES);
    expect(expandPlanFeatures([], { slug: "pro" })).toEqual(PRO_FEATURES);
    expect(expandPlanFeatures([], { slug: "business" })).toEqual(BUSINESS_FEATURES);
  });

  it("unlocks every catalog feature during trial", () => {
    expect(expandPlanFeatures([], { trial: true, slug: "starter" })).toEqual(BUSINESS_FEATURES);
  });

  it("expands Everything in Pro for custom slugs", () => {
    const features = expandPlanFeatures([FEATURE.proBundle, FEATURE.wati], { slug: "growth" });
    expect(features).toEqual(expect.arrayContaining([...PRO_FEATURES, FEATURE.wati]));
  });

  it("locks premium dashboard routes", () => {
    expect(lockedFeatureForPath("/dashboard/analytics")).toBe(FEATURE.analytics);
    expect(lockedFeatureForPath("/dashboard/invoices")).toBe(FEATURE.invoices);
    expect(lockedFeatureForPath("/dashboard/invoices/customize")).toBe(FEATURE.invoices);
    expect(lockedFeatureForPath("/dashboard/tracking")).toBe(FEATURE.trackingPage);
    expect(lockedFeatureForPath("/dashboard/labels/customize")).toBe(FEATURE.packing);
    expect(lockedFeatureForPath("/dashboard/orders")).toBeNull();
    expect(lockedFeatureForPath("/dashboard/integrations")).toBeNull();
    expect(lockedFeatureForPath("/dashboard/automation")).toBeNull();
    expect(lockedFeatureForPath("/dashboard/integrations/wati")).toBe(FEATURE.wati);
  });

  it("locks matching write APIs", () => {
    expect(lockedFeatureForApi("GET", "dashboard/analytics", ["dashboard", "analytics"])).toBe(FEATURE.analytics);
    expect(lockedFeatureForApi("GET", "invoices", ["invoices"])).toBe(FEATURE.invoices);
    expect(lockedFeatureForApi("PUT", "invoice-template", ["invoice-template"])).toBe(FEATURE.invoices);
    expect(lockedFeatureForApi("GET", "tracking", ["tracking"])).toBe(FEATURE.trackingPage);
    expect(lockedFeatureForApi("PATCH", "tracking-pages", ["tracking-pages"])).toBe(FEATURE.trackingPage);
    expect(lockedFeatureForApi("POST", "labels/bulk-download", ["labels", "bulk-download"])).toBe(FEATURE.bulk);
    expect(lockedFeatureForApi("GET", "automation", ["automation"])).toBeNull();
    expect(lockedFeatureForApi("PATCH", "automation", ["automation"])).toBe(FEATURE.automation);
    expect(lockedFeatureForApi("POST", "integrations/shopify", ["integrations", "shopify"])).toBe(FEATURE.shopify);
  });

  it("locks automation toggles until the matching plan feature is included", () => {
    const starter = (feature: string) => STARTER_FEATURES.includes(feature as (typeof STARTER_FEATURES)[number]);
    const pro = (feature: string) => PRO_FEATURES.includes(feature as (typeof PRO_FEATURES)[number]);
    expect(automationToggleLock("autoShopifySync", starter)).toBe(FEATURE.automation);
    expect(automationToggleLock("autoWatiBooked", pro)).toBe(FEATURE.wati);
    expect(automationToggleLock("autoManifest", pro)).toBeNull();
    expect(automationToggleLock("autoLabelPrinting", pro)).toBeNull();
  });
});
