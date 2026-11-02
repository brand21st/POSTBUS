import { Suspense } from "react";
import WooCommerceIntegration from "./woocommerce-client";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading WooCommerce…</p>}>
      <WooCommerceIntegration />
    </Suspense>
  );
}
