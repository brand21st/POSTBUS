import { Suspense } from "react";
import ShopifyIntegrationPage from "./shopify-client";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading Shopify…</p>}>
      <ShopifyIntegrationPage />
    </Suspense>
  );
}
