import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { siteEntityGraph, serializeJsonLd } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.seoTitle,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.name }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  category: "Shipping management software",
  applicationName: siteConfig.name,
  referrer: "origin-when-cross-origin",
  alternates: { canonical: siteConfig.url },
  icons: {
    icon: "/icon",
    apple: "/apple-icon",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.seoTitle,
    description: siteConfig.description,
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
    title: siteConfig.seoTitle,
    description: siteConfig.description,
    images: [absoluteUrl(siteConfig.ogImage)],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={siteConfig.language}
      suppressHydrationWarning
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background font-sans text-foreground">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteEntityGraph()) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
