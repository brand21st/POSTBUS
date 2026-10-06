import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_KEYWORDS,
  formatPolicyKnowledgeSections,
  formatPolicyWhatsAppReply,
  mapOrganizationPolicies,
  matchPolicyIntent,
  normalizePolicyKeywords,
  POLICY_UNPUBLISHED_REPLY,
  WHATSAPP_POLICY_REPLY_MAX,
  emptyOrganizationPolicies,
} from "@/modules/vachat/policies";

const policies = {
  ...emptyOrganizationPolicies(),
  shippingPolicyBody: "We dispatch in 2 business days. Shipping is free over 499.",
  contactBody: "Support 10am–6pm IST.",
  returnsBody: "Returns accepted within 7 days of delivery.",
  termsBody: "All sales are subject to our terms.",
  shippingPolicyKeywords: ["cod charges"],
};

describe("policy keyword matcher", () => {
  it("matches shipping, contact, returns, and terms phrases", () => {
    expect(matchPolicyIntent("What is your shipping policy?")).toBe("shipping_policy");
    expect(matchPolicyIntent("how many delivery days")).toBe("shipping_policy");
    expect(matchPolicyIntent("customer care phone number")).toBe("contact");
    expect(matchPolicyIntent("what is the return policy")).toBe("returns");
    expect(matchPolicyIntent("exchange or refund")).toBe("returns");
    expect(matchPolicyIntent("show t&c")).toBe("terms");
    expect(matchPolicyIntent("privacy policy please")).toBe("terms");
  });

  it("does not steal order tracking or shipped questions", () => {
    expect(matchPolicyIntent("when shipped")).toBeNull();
    expect(matchPolicyIntent("where is my order now")).toBeNull();
    expect(matchPolicyIntent("track my parcel")).toBeNull();
    expect(matchPolicyIntent("Hello")).toBeNull();
  });

  it("uses merchant extra keywords and scores longer phrases higher", () => {
    expect(matchPolicyIntent("what are the COD charges", { shipping_policy: ["cod charges"] })).toBe(
      "shipping_policy"
    );
    expect(matchPolicyIntent("shipping policy and refund")).toBe("shipping_policy");
  });

  it("normalizes comma-separated keywords", () => {
    expect(normalizePolicyKeywords(" COD Charges , COD Charges,  ")).toEqual(["cod charges"]);
  });
});

describe("policy replies and knowledge sections", () => {
  it("formats a WhatsApp policy reply with the merchant name", () => {
    const reply = formatPolicyWhatsAppReply("shipping_policy", policies, { name: "Zoura Parfums" });
    expect(reply).toContain("Zoura Parfums");
    expect(reply).toContain("2 business days");
  });

  it("falls back to org contact fields when contact body is empty", () => {
    const reply = formatPolicyWhatsAppReply(
      "contact",
      { ...policies, contactBody: "" },
      { name: "Zoura Parfums", phone: "9000000001", email: "hi@zoura.example" }
    );
    expect(reply).toContain("Phone 9000000001");
    expect(reply).toContain("hi@zoura.example");
  });

  it("says unpublished when the policy is disabled or empty", () => {
    expect(
      formatPolicyWhatsAppReply("returns", { ...policies, returnsEnabled: false }, { name: "Zoura" })
    ).toContain(POLICY_UNPUBLISHED_REPLY);
    expect(
      formatPolicyWhatsAppReply("terms", { ...emptyOrganizationPolicies(), termsEnabled: true }, { name: "Zoura" })
    ).toContain(POLICY_UNPUBLISHED_REPLY);
  });

  it("clips long WhatsApp replies", () => {
    const long = { ...policies, shippingPolicyBody: "x".repeat(5000) };
    const reply = formatPolicyWhatsAppReply("shipping_policy", long, { name: "Zoura" });
    expect(reply.length).toBeLessThanOrEqual(WHATSAPP_POLICY_REPLY_MAX);
    expect(reply.endsWith("…")).toBe(true);
  });

  it("includes enabled policy sections and keywords in the knowledge document", () => {
    const lines = formatPolicyKnowledgeSections(policies);
    const text = lines.join("\n");
    expect(text).toContain("Shipping policy. Keywords:");
    expect(text).toContain(DEFAULT_POLICY_KEYWORDS.shipping_policy[0]);
    expect(text).toContain("cod charges");
    expect(text).toContain("We dispatch in 2 business days");
    expect(formatPolicyKnowledgeSections({ ...policies, returnsEnabled: false }).join("\n")).not.toContain(
      "Return / exchange"
    );
  });

  it("maps a database row to camelCase defaults", () => {
    expect(mapOrganizationPolicies(null).shippingPolicyEnabled).toBe(true);
    expect(
      mapOrganizationPolicies({
        shipping_policy_body: "Go",
        shipping_policy_enabled: false,
        contact_keywords: ["hours"],
      }).shippingPolicyEnabled
    ).toBe(false);
  });
});
