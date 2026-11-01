import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { env, isShopifyEmbeddedAppEnabled } from "@/lib/env";
import { ShopifyAppShell } from "@/components/shopify-app/app-shell";

export default function ShopifyLayout({ children }: { children: ReactNode }) {
  if (!isShopifyEmbeddedAppEnabled()) notFound();
  return <ShopifyAppShell apiKey={env.shopifyPublicAppClientId}>{children}</ShopifyAppShell>;
}
