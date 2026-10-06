import type { SupabaseClient } from "@supabase/supabase-js";

export const POLICY_BODY_MAX = 8000;
export const WHATSAPP_POLICY_REPLY_MAX = 3500;
export const POLICY_KEYWORD_MAX = 40;
export const POLICY_KEYWORD_LIMIT = 20;

export const POLICY_KINDS = ["shipping_policy", "contact", "returns", "terms", "privacy"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const DEFAULT_POLICY_KEYWORDS: Record<PolicyKind, string[]> = {
  contact: [
    "contact",
    "support hours",
    "customer care",
    "phone number",
    "phone",
    "email",
    "address",
    "gstin",
  ],
  shipping_policy: [
    "shipping policy",
    "delivery time",
    "delivery days",
    "shipping charges",
    "delivery charges",
    "dispatch time",
  ],
  returns: ["return policy", "return window", "exchange", "refund", "replacement"],
  terms: ["terms and conditions", "t&c", "t and c", "terms of service"],
  privacy: ["privacy policy", "privacy", "personal data", "data protection"],
};

export const POLICY_TITLES: Record<PolicyKind, string> = {
  shipping_policy: "Shipping policy",
  contact: "Contact information",
  returns: "Return / exchange",
  terms: "Terms & conditions",
  privacy: "Privacy policy",
};

export const POLICY_UNPUBLISHED_REPLY = "This store has not published that policy yet.";
export const POLICY_PICK_MERCHANT_REPLY =
  "Please send your order number so I can share that store's policy.";

export type OrganizationPolicies = {
  shippingPolicyBody: string;
  contactBody: string;
  returnsBody: string;
  termsBody: string;
  privacyPolicyBody: string;
  shippingPolicyKeywords: string[];
  contactKeywords: string[];
  returnsKeywords: string[];
  termsKeywords: string[];
  privacyPolicyKeywords: string[];
  shippingPolicyEnabled: boolean;
  contactEnabled: boolean;
  returnsEnabled: boolean;
  termsEnabled: boolean;
  privacyPolicyEnabled: boolean;
};

export type OrganizationPoliciesRow = {
  shipping_policy_body?: string | null;
  contact_body?: string | null;
  returns_body?: string | null;
  terms_body?: string | null;
  privacy_policy_body?: string | null;
  shipping_policy_keywords?: string[] | null;
  contact_keywords?: string[] | null;
  returns_keywords?: string[] | null;
  terms_keywords?: string[] | null;
  privacy_policy_keywords?: string[] | null;
  shipping_policy_enabled?: boolean | null;
  contact_enabled?: boolean | null;
  returns_enabled?: boolean | null;
  terms_enabled?: boolean | null;
  privacy_policy_enabled?: boolean | null;
};

export function emptyOrganizationPolicies(): OrganizationPolicies {
  return {
    shippingPolicyBody: "",
    contactBody: "",
    returnsBody: "",
    termsBody: "",
    privacyPolicyBody: "",
    shippingPolicyKeywords: [],
    contactKeywords: [],
    returnsKeywords: [],
    termsKeywords: [],
    privacyPolicyKeywords: [],
    shippingPolicyEnabled: true,
    contactEnabled: true,
    returnsEnabled: true,
    termsEnabled: true,
    privacyPolicyEnabled: true,
  };
}

export function normalizePolicyKeywords(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const term = String(item ?? "")
      .trim()
      .toLowerCase()
      .slice(0, POLICY_KEYWORD_MAX);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= POLICY_KEYWORD_LIMIT) break;
  }
  return out;
}

export function mapOrganizationPolicies(row?: OrganizationPoliciesRow | null): OrganizationPolicies {
  const empty = emptyOrganizationPolicies();
  if (!row) return empty;
  return {
    shippingPolicyBody: String(row.shipping_policy_body ?? ""),
    contactBody: String(row.contact_body ?? ""),
    returnsBody: String(row.returns_body ?? ""),
    termsBody: String(row.terms_body ?? ""),
    privacyPolicyBody: String(row.privacy_policy_body ?? ""),
    shippingPolicyKeywords: normalizePolicyKeywords(row.shipping_policy_keywords),
    contactKeywords: normalizePolicyKeywords(row.contact_keywords),
    returnsKeywords: normalizePolicyKeywords(row.returns_keywords),
    termsKeywords: normalizePolicyKeywords(row.terms_keywords),
    privacyPolicyKeywords: normalizePolicyKeywords(row.privacy_policy_keywords),
    shippingPolicyEnabled: row.shipping_policy_enabled !== false,
    contactEnabled: row.contact_enabled !== false,
    returnsEnabled: row.returns_enabled !== false,
    termsEnabled: row.terms_enabled !== false,
    privacyPolicyEnabled: row.privacy_policy_enabled !== false,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordHits(query: string, keywords: string[]) {
  const ranked = [...keywords].sort((a, b) => b.length - a.length);
  let score = 0;
  let hits = 0;
  for (const keyword of ranked) {
    if (!keyword) continue;
    const pattern =
      keyword.includes(" ") || /[^a-z0-9]/i.test(keyword)
        ? keyword
        : new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
    const matched = typeof pattern === "string" ? query.includes(pattern) : pattern.test(query);
    if (!matched) continue;
    hits += 1;
    score += keyword.length;
  }
  return { hits, score };
}

export function matchPolicyIntent(text: string, extras?: Partial<Record<PolicyKind, string[]>>): PolicyKind | null {
  const q = text.toLowerCase();
  if (!q.trim()) return null;
  let best: PolicyKind | null = null;
  let bestScore = 0;
  for (const kind of POLICY_KINDS) {
    const keywords = [...DEFAULT_POLICY_KEYWORDS[kind], ...(extras?.[kind] ?? [])];
    const { score } = keywordHits(q, keywords);
    if (score > bestScore) {
      bestScore = score;
      best = kind;
    }
  }
  return bestScore > 0 ? best : null;
}

export function policyKeywordsForDocument(kind: PolicyKind, extras: string[] = []) {
  return [...new Set([...DEFAULT_POLICY_KEYWORDS[kind], ...normalizePolicyKeywords(extras)])];
}

function bodyForKind(policies: OrganizationPolicies, kind: PolicyKind) {
  if (kind === "shipping_policy") return policies.shippingPolicyBody;
  if (kind === "contact") return policies.contactBody;
  if (kind === "returns") return policies.returnsBody;
  if (kind === "privacy") return policies.privacyPolicyBody;
  return policies.termsBody;
}

function enabledForKind(policies: OrganizationPolicies, kind: PolicyKind) {
  if (kind === "shipping_policy") return policies.shippingPolicyEnabled;
  if (kind === "contact") return policies.contactEnabled;
  if (kind === "returns") return policies.returnsEnabled;
  if (kind === "privacy") return policies.privacyPolicyEnabled;
  return policies.termsEnabled;
}

function extrasForKind(policies: OrganizationPolicies, kind: PolicyKind) {
  if (kind === "shipping_policy") return policies.shippingPolicyKeywords;
  if (kind === "contact") return policies.contactKeywords;
  if (kind === "returns") return policies.returnsKeywords;
  if (kind === "privacy") return policies.privacyPolicyKeywords;
  return policies.termsKeywords;
}

export function policyExtrasMap(policies: OrganizationPolicies): Record<PolicyKind, string[]> {
  return {
    shipping_policy: policies.shippingPolicyKeywords,
    contact: policies.contactKeywords,
    returns: policies.returnsKeywords,
    terms: policies.termsKeywords,
    privacy: policies.privacyPolicyKeywords,
  };
}

export function formatPolicyKnowledgeSections(policies?: OrganizationPolicies | null) {
  if (!policies) return [] as string[];
  const lines: string[] = [];
  for (const kind of POLICY_KINDS) {
    if (!enabledForKind(policies, kind)) continue;
    const body = bodyForKind(policies, kind).trim();
    if (!body) continue;
    const keywords = policyKeywordsForDocument(kind, extrasForKind(policies, kind)).join(", ");
    lines.push(`${POLICY_TITLES[kind]}. Keywords: ${keywords}.`);
    lines.push(body);
  }
  return lines;
}

function clipWhatsApp(text: string) {
  if (text.length <= WHATSAPP_POLICY_REPLY_MAX) return text;
  const sliced = text.slice(0, WHATSAPP_POLICY_REPLY_MAX - 1);
  const cut = Math.max(sliced.lastIndexOf("\n"), sliced.lastIndexOf(" "));
  return `${(cut > 200 ? sliced.slice(0, cut) : sliced).trimEnd()}…`;
}

export type PolicyContactFallback = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
  gstin?: string | null;
};

export function formatPolicyWhatsAppReply(
  kind: PolicyKind,
  policies: OrganizationPolicies,
  merchant: PolicyContactFallback
) {
  const name = merchant.name?.trim() || "This store";
  if (!enabledForKind(policies, kind)) {
    return `${name}: ${POLICY_UNPUBLISHED_REPLY}`;
  }
  const body = bodyForKind(policies, kind).trim();
  const contactFallback =
    kind === "contact"
      ? [
          merchant.phone ? `Phone ${merchant.phone}.` : null,
          merchant.email ? `Email ${merchant.email}.` : null,
          merchant.website ? `Website ${merchant.website}.` : null,
          merchant.gstin ? `GSTIN ${merchant.gstin}.` : null,
          merchant.address ? `Address ${merchant.address}.` : null,
        ].filter(Boolean)
      : [];
  if (!body && !contactFallback.length) {
    return `${name}: ${POLICY_UNPUBLISHED_REPLY}`;
  }
  const parts = [`${name} ${POLICY_TITLES[kind]}.`, body || null, ...contactFallback].filter(Boolean) as string[];
  return clipWhatsApp(parts.join(" "));
}

export async function loadOrganizationPolicies(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("organization_policies")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return mapOrganizationPolicies(data);
}

export async function loadPolicyReplyContext(supabase: SupabaseClient, organizationId: string) {
  const [policies, { data: org }, { data: invoice }] = await Promise.all([
    loadOrganizationPolicies(supabase, organizationId),
    supabase
      .from("organizations")
      .select("id, name, phone, line1, line2, city, state, pincode")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("invoice_settings")
      .select("website, business_email, gstin")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  const address = [org?.line1, org?.line2, org?.city, org?.state, org?.pincode].filter(Boolean).join(", ");
  return {
    policies,
    merchant: {
      name: String(org?.name ?? "").trim() || "This store",
      phone: typeof org?.phone === "string" ? org.phone.trim() : null,
      website: typeof invoice?.website === "string" ? invoice.website.trim() : null,
      email: typeof invoice?.business_email === "string" ? invoice.business_email.trim() : null,
      gstin: typeof invoice?.gstin === "string" ? invoice.gstin.trim() : null,
      address: address || null,
    } satisfies PolicyContactFallback,
  };
}
