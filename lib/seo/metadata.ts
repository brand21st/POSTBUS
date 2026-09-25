import type { Metadata } from "next";
import { siteConfig } from "@/lib/site-config";

type MarketingMetadataInput = {
  title: string;
  description: string;
  path: `/${string}` | "/";
  keywords?: readonly string[];
  absoluteTitle?: boolean;
};

export function absoluteUrl(path: string = "/") {
  return new URL(path, siteConfig.url).toString();
}

export function marketingMetadata({
  title,
  description,
  path,
  keywords = siteConfig.keywords,
  absoluteTitle = false,
}: MarketingMetadataInput): Metadata {
  const canonical = absoluteUrl(path);
  const resolvedTitle = absoluteTitle ? title : `${title} · ${siteConfig.name}`;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    keywords: [...keywords],
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: siteConfig.locale,
      url: canonical,
      siteName: siteConfig.name,
      title: resolvedTitle,
      description,
      images: [
        {
          url: absoluteUrl(siteConfig.ogImage),
          width: 1200,
          height: 630,
          alt: "PostBus India Post shipping management platform",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description,
      images: [absoluteUrl(siteConfig.ogImage)],
    },
  };
}

export const noIndexMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};
