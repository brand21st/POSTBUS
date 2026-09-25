import { absoluteUrl } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";

export type FaqEntry = {
  q: string;
  a: string;
};

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const entityIds = {
  organization: `${siteConfig.url}/#organization`,
  website: `${siteConfig.url}/#website`,
  application: `${siteConfig.url}/#software-application`,
} as const;

export function siteEntityGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": entityIds.organization,
        name: siteConfig.legalName,
        url: siteConfig.url,
        logo: absoluteUrl("/icon"),
        email: siteConfig.contactEmail,
        areaServed: {
          "@type": "Country",
          name: "India",
        },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: siteConfig.contactEmail,
          availableLanguage: ["English"],
          areaServed: siteConfig.country,
        },
      },
      {
        "@type": "WebSite",
        "@id": entityIds.website,
        name: siteConfig.name,
        url: siteConfig.url,
        description: siteConfig.description,
        inLanguage: siteConfig.language,
        publisher: { "@id": entityIds.organization },
      },
      {
        "@type": "SoftwareApplication",
        "@id": entityIds.application,
        name: siteConfig.name,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Shipping management software",
        operatingSystem: "Web",
        url: siteConfig.url,
        description: siteConfig.description,
        inLanguage: siteConfig.language,
        provider: { "@id": entityIds.organization },
        audience: {
          "@type": "BusinessAudience",
          audienceType:
            "Ecommerce businesses using an existing India Post Customer ID",
        },
        featureList: [
          "Order management",
          "India Post shipment booking",
          "Shipping labels and barcode workflows",
          "AWB tracking updates",
          "Invoices",
          "Shipping analytics",
          "Shopify order sync",
          "Manual order entry",
        ],
      },
    ],
  };
}

export function webPageJsonLd(input: {
  name: string;
  description: string;
  path: string;
}) {
  const url = absoluteUrl(input.path);

  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: input.name,
    description: input.description,
    inLanguage: siteConfig.language,
    isPartOf: { "@id": entityIds.website },
    about: { "@id": entityIds.application },
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqJsonLd(entries: readonly FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };
}
