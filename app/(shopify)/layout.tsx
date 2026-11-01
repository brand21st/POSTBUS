import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { env, isShopifyEmbeddedAppEnabled } from "@/lib/env";

export const metadata: Metadata = {
  title: "PostBus",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout for the Shopify embedded app. It is separate from the site's root layout because
 * App Bridge must be the first, synchronous <script> in the document; the site layout's providers,
 * fonts, analytics and Tailwind CSS never load inside Shopify Admin.
 */
export default function ShopifyRootLayout({ children }: { children: ReactNode }) {
  const enabled = isShopifyEmbeddedAppEnabled();
  const apiKey = env.shopifyPublicAppClientId;
  return (
    <html lang="en">
      <head>
        {enabled && apiKey ? <meta name="shopify-api-key" content={apiKey} /> : null}
        {/* Plain, blocking script tags on purpose: App Bridge refuses to start if async/defer. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        {enabled ? <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" /> : null}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        {enabled ? <script src="https://cdn.shopify.com/shopifycloud/polaris.js" /> : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
