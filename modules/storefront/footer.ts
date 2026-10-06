import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import type { OrganizationPolicies } from "@/modules/vachat/policies";

const HEX = /^#[0-9A-Fa-f]{6}$/;

export const FOOTER_SOCIAL_NETWORKS = ["instagram", "facebook", "youtube", "x", "linkedin"] as const;
export type FooterSocialNetwork = (typeof FOOTER_SOCIAL_NETWORKS)[number];

export const FOOTER_SECTION_KEYS = [
  "brand",
  "shop",
  "support",
  "policies",
  "business",
  "social",
  "trust",
  "poweredBy",
] as const;
export type FooterSectionKey = (typeof FOOTER_SECTION_KEYS)[number];

export const STORE_POLICY_SLUGS = ["privacy-policy", "terms", "shipping", "returns"] as const;
export type StorePolicySlug = (typeof STORE_POLICY_SLUGS)[number];

export const STORE_POLICY_TITLES: Record<StorePolicySlug, string> = {
  "privacy-policy": "Privacy Policy",
  terms: "Terms & Conditions",
  shipping: "Shipping Policy",
  returns: "Return / Refund Policy",
};

export type StorefrontFooterConfig = {
  enabled: boolean;
  layout: "columns" | "stacked";
  backgroundColor: string | null;
  textColor: string | null;
  headingColor: string | null;
  accentColor: string | null;
  borderColor: string | null;
  sections: Record<FooterSectionKey, boolean>;
  social: {
    order: FooterSocialNetwork[];
    items: Record<FooterSocialNetwork, { enabled: boolean; url: string }>;
  };
};

export type StoreFooterLink = { label: string; href?: string; external?: boolean };
export type StoreFooterSocial = { id: FooterSocialNetwork; label: string; href: string };

export type StoreFooter = {
  appearance: {
    layout: "columns" | "stacked";
    backgroundColor: string;
    textColor: string;
    headingColor: string;
    accentColor: string;
    borderColor: string;
  };
  brand: { logoUrl: string | null; name: string; tagline: string | null } | null;
  shop: StoreFooterLink[];
  support: StoreFooterLink[];
  policies: StoreFooterLink[];
  social: StoreFooterSocial[];
  business: {
    name: string;
    lines: string[];
  } | null;
  trust: StoreFooterLink[];
  poweredBy: boolean;
  copyrightName: string;
};

export const DEFAULT_FOOTER_CONFIG: StorefrontFooterConfig = {
  enabled: true,
  layout: "columns",
  backgroundColor: null,
  textColor: null,
  headingColor: null,
  accentColor: null,
  borderColor: null,
  sections: {
    brand: true,
    shop: true,
    support: true,
    policies: true,
    business: true,
    social: true,
    trust: true,
    poweredBy: true,
  },
  social: {
    order: [...FOOTER_SOCIAL_NETWORKS],
    items: {
      instagram: { enabled: true, url: "" },
      facebook: { enabled: true, url: "" },
      youtube: { enabled: true, url: "" },
      x: { enabled: true, url: "" },
      linkedin: { enabled: true, url: "" },
    },
  },
};

const SOCIAL_LABELS: Record<FooterSocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return HEX.test(next) ? next : null;
}

function parseBool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizePublicHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeStorefrontFooterConfig(raw: unknown): StorefrontFooterConfig {
  const row = asRecord(raw);
  const sectionsRaw = asRecord(row.sections);
  const socialRaw = asRecord(row.social);
  const itemsRaw = asRecord(socialRaw.items ?? socialRaw);
  const orderRaw = Array.isArray(socialRaw.order) ? socialRaw.order : FOOTER_SOCIAL_NETWORKS;
  const order = [
    ...orderRaw.filter((item): item is FooterSocialNetwork =>
      FOOTER_SOCIAL_NETWORKS.includes(item as FooterSocialNetwork)
    ),
    ...FOOTER_SOCIAL_NETWORKS,
  ].filter((item, index, all) => all.indexOf(item) === index) as FooterSocialNetwork[];

  const items = { ...DEFAULT_FOOTER_CONFIG.social.items };
  for (const network of FOOTER_SOCIAL_NETWORKS) {
    const item = asRecord(itemsRaw[network]);
    const url = typeof item.url === "string" ? item.url.trim() : typeof itemsRaw[network] === "string" ? String(itemsRaw[network]).trim() : "";
    items[network] = {
      enabled: parseBool(item.enabled, true),
      url: url.slice(0, 300),
    };
  }

  const sections = { ...DEFAULT_FOOTER_CONFIG.sections };
  for (const key of FOOTER_SECTION_KEYS) {
    sections[key] = parseBool(sectionsRaw[key], true);
  }

  return {
    enabled: parseBool(row.enabled, true),
    layout: row.layout === "stacked" ? "stacked" : "columns",
    backgroundColor: parseHex(row.backgroundColor),
    textColor: parseHex(row.textColor),
    headingColor: parseHex(row.headingColor),
    accentColor: parseHex(row.accentColor),
    borderColor: parseHex(row.borderColor),
    sections,
    social: { order, items },
  };
}

export function storefrontFooterConfigPatch(value: unknown) {
  return normalizeStorefrontFooterConfig(value);
}

function policyPublished(enabled: boolean, body: string) {
  return enabled && body.trim().length > 0;
}

export function storePolicyPath(workspace: string, slug: StorePolicySlug) {
  return `/store/${workspace}/${slug}`;
}

export function storeHomePath(workspace: string) {
  return `/store/${workspace}`;
}

export type StoreFooterSources = {
  storeName: string;
  logoUrl: string | null;
  tagline: string | null;
  accentColor: string;
  workspace: string;
  organization: {
    name?: string | null;
    phone?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  } | null;
  email?: string | null;
  policies: Pick<
    OrganizationPolicies,
    | "privacyPolicyBody"
    | "privacyPolicyEnabled"
    | "termsBody"
    | "termsEnabled"
    | "shippingPolicyBody"
    | "shippingPolicyEnabled"
    | "returnsBody"
    | "returnsEnabled"
  >;
  categories: Array<{ name: string; slug: string }>;
  hasProducts: boolean;
  hasBestSellers: boolean;
  payments: { prepaid: boolean; cod: boolean; partial: boolean };
};

export function assembleStoreFooter(config: StorefrontFooterConfig, sources: StoreFooterSources): StoreFooter | null {
  if (!config.enabled) return null;
  const accent = config.accentColor || sources.accentColor || "#E11D48";
  const home = storeHomePath(sources.workspace);
  const org = sources.organization;
  const businessName = (org?.name ?? "").trim() || sources.storeName;
  const phone = (org?.phone ?? "").trim() || null;
  const email = (sources.email ?? "").trim() || null;
  const whatsapp = phone ? extractIndiaMobileDigits(phone) : null;

  const shop: StoreFooterLink[] = [];
  if (sources.hasProducts) shop.push({ label: "All Products", href: `${home}#all-products` });
  for (const category of sources.categories.slice(0, 8)) {
    shop.push({ label: category.name, href: `${home}/category/${category.slug}` });
  }
  if (sources.hasBestSellers) shop.push({ label: "Best Sellers", href: `${home}#best-sellers` });

  const support: StoreFooterLink[] = [];
  if (phone) support.push({ label: phone, href: `tel:${phone.replace(/\s+/g, "")}` });
  if (email) support.push({ label: email, href: `mailto:${email}` });
  if (whatsapp) {
    support.push({
      label: "WhatsApp",
      href: `https://wa.me/91${whatsapp}`,
      external: true,
    });
  }

  const policies: StoreFooterLink[] = [];
  if (policyPublished(sources.policies.privacyPolicyEnabled, sources.policies.privacyPolicyBody)) {
    policies.push({
      label: STORE_POLICY_TITLES["privacy-policy"],
      href: storePolicyPath(sources.workspace, "privacy-policy"),
    });
  }
  if (policyPublished(sources.policies.termsEnabled, sources.policies.termsBody)) {
    policies.push({ label: STORE_POLICY_TITLES.terms, href: storePolicyPath(sources.workspace, "terms") });
  }
  if (policyPublished(sources.policies.shippingPolicyEnabled, sources.policies.shippingPolicyBody)) {
    policies.push({ label: STORE_POLICY_TITLES.shipping, href: storePolicyPath(sources.workspace, "shipping") });
  }
  if (policyPublished(sources.policies.returnsEnabled, sources.policies.returnsBody)) {
    policies.push({ label: STORE_POLICY_TITLES.returns, href: storePolicyPath(sources.workspace, "returns") });
  }

  const social: StoreFooterSocial[] = [];
  for (const id of config.social.order) {
    const item = config.social.items[id];
    if (!item?.enabled) continue;
    const href = sanitizePublicHttpUrl(item.url);
    if (!href) continue;
    social.push({ id, label: SOCIAL_LABELS[id], href });
  }

  const addressLines = [org?.line1, org?.line2, [org?.city, org?.state, org?.pincode].filter(Boolean).join(", ")]
    .map((line) => (line ?? "").trim())
    .filter(Boolean);
  if (addressLines.length) addressLines.push("India");

  const trust: StoreFooterLink[] = [{ label: "Secure Checkout" }];
  if (sources.payments.prepaid) trust.push({ label: "Prepaid" });
  if (sources.payments.cod) trust.push({ label: "COD" });
  if (sources.payments.partial) trust.push({ label: "Partial Payment" });
  trust.push({ label: "Order Tracking", href: "/track" });

  const sections = config.sections;
  const brand =
    sections.brand && (sources.storeName || sources.logoUrl || sources.tagline)
      ? {
          logoUrl: sources.logoUrl,
          name: sources.storeName,
          tagline: sources.tagline?.trim() || null,
        }
      : null;

  return {
    appearance: {
      layout: config.layout,
      backgroundColor: config.backgroundColor || "#18181b",
      textColor: config.textColor || "#d4d4d8",
      headingColor: config.headingColor || "#fafafa",
      accentColor: accent,
      borderColor: config.borderColor || "#3f3f46",
    },
    brand,
    shop: sections.shop ? shop : [],
    support: sections.support ? support : [],
    policies: sections.policies ? policies : [],
    social: sections.social ? social : [],
    business:
      sections.business && (businessName || addressLines.length)
        ? { name: businessName, lines: addressLines }
        : null,
    trust: sections.trust ? trust : [],
    poweredBy: sections.poweredBy,
    copyrightName: (sources.storeName || businessName).trim(),
  };
}

export function policyBodyForSlug(slug: StorePolicySlug, policies: OrganizationPolicies) {
  if (slug === "privacy-policy") {
    return policies.privacyPolicyEnabled ? policies.privacyPolicyBody.trim() : "";
  }
  if (slug === "terms") return policies.termsEnabled ? policies.termsBody.trim() : "";
  if (slug === "shipping") return policies.shippingPolicyEnabled ? policies.shippingPolicyBody.trim() : "";
  return policies.returnsEnabled ? policies.returnsBody.trim() : "";
}
