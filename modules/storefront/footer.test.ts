import { describe, expect, it } from "vitest";
import { emptyOrganizationPolicies } from "@/modules/vachat/policies";
import {
  assembleStoreFooter,
  DEFAULT_FOOTER_CONFIG,
  normalizeStorefrontFooterConfig,
  policyBodyForSlug,
  sanitizePublicHttpUrl,
} from "@/modules/storefront/footer";

const sources = {
  storeName: "Zoura Parfums",
  logoUrl: "https://cdn.example/logo.png",
  tagline: "Attars from Kannauj",
  accentColor: "#E11D48",
  workspace: "zoura-parfums",
  organization: {
    name: "Zoura Parfums LLP",
    phone: "9876543210",
    line1: "12 Perfume Lane",
    line2: "",
    city: "Kannauj",
    state: "Uttar Pradesh",
    pincode: "209725",
  },
  email: "hello@zoura.example",
  policies: {
    ...emptyOrganizationPolicies(),
    privacyPolicyBody: "We keep your data private.",
    termsBody: "Pay before dispatch.",
    shippingPolicyBody: "Ships in 2 days.",
    returnsBody: "7 day returns.",
  },
  categories: [{ name: "Attars", slug: "attars" }],
  hasProducts: true,
  hasBestSellers: true,
  payments: { prepaid: true, cod: true, partial: true },
};

describe("storefront footer config", () => {
  it("defaults missing jsonb to enabled columns layout", () => {
    const parsed = normalizeStorefrontFooterConfig(null);
    expect(parsed.enabled).toBe(true);
    expect(parsed.layout).toBe("columns");
    expect(parsed.social.order).toEqual(["instagram", "facebook", "youtube", "x", "linkedin"]);
  });

  it("rejects javascript URLs", () => {
    expect(sanitizePublicHttpUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePublicHttpUrl("https://instagram.com/zoura")).toContain("instagram.com");
  });
});

describe("assembleStoreFooter", () => {
  it("maps settings contact, policies, and payments without empty sections", () => {
    const footer = assembleStoreFooter(DEFAULT_FOOTER_CONFIG, sources);
    expect(footer?.brand?.name).toBe("Zoura Parfums");
    expect(footer?.support.map((item) => item.href)).toEqual([
      "tel:9876543210",
      "mailto:hello@zoura.example",
      "https://wa.me/919876543210",
    ]);
    expect(footer?.policies.map((item) => item.href)).toEqual([
      "/store/zoura-parfums/privacy-policy",
      "/store/zoura-parfums/terms",
      "/store/zoura-parfums/shipping",
      "/store/zoura-parfums/returns",
    ]);
    expect(footer?.business?.lines).toContain("India");
    expect(footer?.trust.map((item) => item.label)).toEqual([
      "Secure Checkout",
      "Prepaid",
      "COD",
      "Partial Payment",
      "Order Tracking",
    ]);
    expect(footer?.shop.some((item) => item.label === "Attars")).toBe(true);
  });

  it("hides missing contact, policies, and socials", () => {
    const footer = assembleStoreFooter(DEFAULT_FOOTER_CONFIG, {
      ...sources,
      organization: { name: "Zoura", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" },
      email: null,
      policies: emptyOrganizationPolicies(),
      categories: [],
      hasProducts: false,
      hasBestSellers: false,
      payments: { prepaid: false, cod: false, partial: false },
    });
    expect(footer?.support).toEqual([]);
    expect(footer?.policies).toEqual([]);
    expect(footer?.shop).toEqual([]);
    expect(footer?.social).toEqual([]);
    expect(footer?.trust.map((item) => item.label)).toEqual(["Secure Checkout", "Order Tracking"]);
    expect(footer?.business?.lines).toEqual([]);
  });

  it("returns null when the footer is disabled", () => {
    expect(assembleStoreFooter({ ...DEFAULT_FOOTER_CONFIG, enabled: false }, sources)).toBeNull();
  });

  it("only emits enabled social URLs in configured order", () => {
    const config = normalizeStorefrontFooterConfig({
      social: {
        order: ["youtube", "instagram"],
        items: {
          youtube: { enabled: true, url: "https://youtube.com/@zoura" },
          instagram: { enabled: false, url: "https://instagram.com/zoura" },
          facebook: { enabled: true, url: "https://facebook.com/zoura" },
        },
      },
    });
    const footer = assembleStoreFooter(config, sources);
    expect(footer?.social.map((item) => item.id)).toEqual(["youtube", "facebook"]);
  });
});

describe("policyBodyForSlug", () => {
  it("hides disabled policy bodies", () => {
    expect(policyBodyForSlug("privacy-policy", sources.policies)).toContain("private");
    expect(policyBodyForSlug("privacy-policy", { ...sources.policies, privacyPolicyEnabled: false })).toBe("");
  });
});
