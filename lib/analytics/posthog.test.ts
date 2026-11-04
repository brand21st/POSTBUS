import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  __loaded: true as boolean,
}));
const { init, capture } = ph;
vi.mock("posthog-js", () => ({ default: ph }));

import {
  analyticsDecision,
  analyticsUserFromMe,
  identifyUser,
  personProperties,
  resetAnalyticsUser,
  initAnalytics,
  isShopifyEmbeddedPath,
  POSTHOG_DEFAULT_HOST,
  posthogInitOptions,
  PURCHASE_EVENTS,
  trackPurchase,
} from "./posthog";

const prod = { token: "phc_test", host: "https://us.i.posthog.com", pathname: "/dashboard", hostname: "www.postbus.in" };

beforeEach(() => {
  ph.__loaded = true;
  resetAnalyticsUser();
  for (const fn of [ph.init, ph.capture, ph.identify, ph.reset]) fn.mockReset();
});

describe("analyticsDecision", () => {
  it("enables on the production site", () => {
    expect(analyticsDecision(prod)).toEqual({ enabled: true });
  });

  it.each([undefined, "", "   "])("stays off without a token (%j)", (token) => {
    expect(analyticsDecision({ ...prod, token })).toEqual({ enabled: false, reason: "no-token" });
  });

  it.each(["/shopify", "/shopify/orders", "/shopify/settings/india-post"])("stays off inside Shopify Admin (%s)", (pathname) => {
    expect(analyticsDecision({ ...prod, pathname })).toEqual({ enabled: false, reason: "shopify-embedded" });
  });

  it("still tracks the public Shopify marketing page", () => {
    expect(isShopifyEmbeddedPath("/shopify-india-post")).toBe(false);
    expect(analyticsDecision({ ...prod, pathname: "/shopify-india-post" })).toEqual({ enabled: true });
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "app.localhost"])("stays off on local dev host %s", (hostname) => {
    expect(analyticsDecision({ ...prod, hostname })).toEqual({ enabled: false, reason: "local-dev" });
  });

  it("tracks tenant subdomains", () => {
    expect(analyticsDecision({ ...prod, hostname: "evlathholdings.postbus.in" })).toEqual({ enabled: true });
  });
});

describe("initAnalytics", () => {
  it("initialises PostHog with the trimmed token and project options", () => {
    expect(initAnalytics({ ...prod, token: "  phc_test \n" })).toBe(true);
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith("phc_test", {
      api_host: "https://us.i.posthog.com",
      defaults: "2026-05-30",
      person_profiles: "identified_only",
    });
  });

  it("falls back to the US ingest host", () => {
    expect(posthogInitOptions(undefined).api_host).toBe(POSTHOG_DEFAULT_HOST);
    expect(posthogInitOptions("  ").api_host).toBe(POSTHOG_DEFAULT_HOST);
  });

  it("does not initialise when disabled", () => {
    expect(initAnalytics({ ...prod, pathname: "/shopify/orders" })).toBe(false);
    expect(initAnalytics({ ...prod, hostname: "localhost" })).toBe(false);
    expect(initAnalytics({ ...prod, token: undefined })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});

const me = {
  user: { id: "user-uuid-1", email: "owner@shop.in", fullName: "Shop Owner", whatsappNumber: "+919999999999" },
  organization: { id: "org-uuid-1", name: "Acme Traders", slug: "acme" },
  role: "OWNER",
  subscription: { planCode: "GROWTH", status: "ACTIVE", trial: false },
};

describe("identifyUser", () => {
  it("identifies by user id with organisation, role and plan only", () => {
    expect(identifyUser(analyticsUserFromMe(me))).toBe(true);
    expect(ph.identify).toHaveBeenCalledWith("user-uuid-1", {
      organization_id: "org-uuid-1",
      role: "OWNER",
      plan_code: "GROWTH",
      subscription_status: "ACTIVE",
    });
  });

  it("never sends email, name, phone or organisation name", () => {
    identifyUser(analyticsUserFromMe(me));
    const sent = JSON.stringify(ph.identify.mock.calls);
    for (const pii of ["owner@shop.in", "Shop Owner", "+919999999999", "Acme Traders"]) {
      expect(sent).not.toContain(pii);
    }
  });

  it("omits empty properties for a user with no organisation yet", () => {
    expect(personProperties(analyticsUserFromMe({ user: { id: "u2" }, organization: null }))).toEqual({});
  });

  it("does not re-send for the same user and properties", () => {
    identifyUser(analyticsUserFromMe(me));
    expect(identifyUser(analyticsUserFromMe(me))).toBe(false);
    expect(ph.identify).toHaveBeenCalledOnce();
  });

  it("re-sends when the plan changes, e.g. after a purchase", () => {
    identifyUser(analyticsUserFromMe(me));
    identifyUser(analyticsUserFromMe({ ...me, subscription: { planCode: "PRO", status: "ACTIVE" } }));
    expect(ph.identify).toHaveBeenCalledTimes(2);
    expect(ph.identify.mock.calls[1][1]).toMatchObject({ plan_code: "PRO" });
  });

  it("is a no-op when PostHog was never started (local dev, Shopify Admin)", () => {
    ph.__loaded = false;
    expect(identifyUser(analyticsUserFromMe(me))).toBe(false);
    resetAnalyticsUser();
    expect(ph.identify).not.toHaveBeenCalled();
    expect(ph.reset).not.toHaveBeenCalled();
  });
});

describe("resetAnalyticsUser", () => {
  it("resets PostHog and lets the next sign-in identify again", () => {
    identifyUser(analyticsUserFromMe(me));
    resetAnalyticsUser();
    expect(ph.reset).toHaveBeenCalledOnce();
    identifyUser(analyticsUserFromMe(me));
    expect(ph.identify).toHaveBeenCalledTimes(2);
  });
});

describe("trackPurchase", () => {
  it("sends plan purchases instantly with rupee amount and product", () => {
    trackPurchase("plan", 49_900);
    expect(capture).toHaveBeenCalledWith(
      "purchase_completed",
      { product: "plan", amount: 499, currency: "INR" },
      { send_instantly: true },
    );
  });

  it("tells AI credit packs apart from plans", () => {
    trackPurchase("ai-credits", 19_900, { packSize: 1000 });
    expect(capture).toHaveBeenCalledWith(
      "purchase_completed",
      { product: "ai-credits", amount: 199, currency: "INR", packSize: 1000 },
      { send_instantly: true },
    );
  });

  it("keeps the existing add-on event name and addon property", () => {
    trackPurchase("addon:ai-accountant", 99_900);
    expect(capture).toHaveBeenCalledWith(
      "addon_purchase_completed",
      { product: "addon:ai-accountant", amount: 999, currency: "INR", addon: "ai-accountant" },
      { send_instantly: true },
    );
  });

  it("keeps event names stable for existing PostHog insights", () => {
    expect(PURCHASE_EVENTS).toEqual({
      plan: "purchase_completed",
      "ai-credits": "purchase_completed",
      "addon:ai-accountant": "addon_purchase_completed",
    });
  });
});

describe("wiring", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("instrumentation-client starts PostHog only through initAnalytics", () => {
    const src = read("instrumentation-client.ts");
    expect(src).toContain("initAnalytics(");
    expect(src).toContain("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
    expect(src).not.toMatch(/posthog\.init\(/);
  });

  it.each([
    ["components/billing/checkout-button.tsx", 'trackPurchase("plan"'],
    ["components/billing/ai-credits-checkout-button.tsx", 'trackPurchase("ai-credits"'],
    ["components/addons/ai-accountant-card.tsx", 'trackPurchase("addon:ai-accountant"'],
  ])("%s tracks its purchase after verify", (file, call) => {
    const src = read(file);
    expect(src).toContain(call);
    expect(src.indexOf("/api/v1/billing/verify")).toBeLessThan(src.indexOf(call));
    expect(src).not.toMatch(/posthog\.capture\(/);
  });

  it.each(["components/dashboard/shell.tsx", "components/admin/shell.tsx"])("%s identifies the signed-in user", (file) => {
    expect(read(file)).toContain("useIdentifyAnalyticsUser()");
  });

  it.each([
    "components/dashboard/topbar.tsx",
    "components/admin/account-menu.tsx",
    "components/affiliates/partner-dashboard.tsx",
    "components/affiliates/partner-shell.tsx",
  ])("%s resets analytics before signing out", (file) => {
    const src = read(file);
    const reset = src.indexOf("resetAnalyticsUser()");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(src.indexOf("auth.signOut()"));
  });

  it("every client sign-out in the app resets analytics", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const src = read(rel);
          if (!src.includes('"use client"')) continue;
          const signOuts = src.split("auth.signOut(").length - 1;
          const resets = src.split("resetAnalyticsUser()").length - 1;
          if (signOuts > resets) offenders.push(rel);
        }
      }
    };
    ["app", "components", "lib"].forEach(walk);
    expect(offenders).toEqual([]);
  });

  it("CSP allows PostHog ingest (connect-src) and its asset host scripts (script-src)", async () => {
    const { contentSecurityPolicy } = await import("@/lib/security/headers");
    const directives = Object.fromEntries(
      contentSecurityPolicy()
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources]),
    );
    // us.i.posthog.com (events, flags) and us-assets.i.posthog.com (recorder, surveys) both match.
    expect(directives["connect-src"]).toContain("https://*.i.posthog.com");
    expect(directives["script-src"]).toContain("https://*.i.posthog.com");
  });
});
