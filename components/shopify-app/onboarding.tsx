"use client";

import { useEffect, useState } from "react";
import { useShopifyAppFetch } from "@/components/shopify-app/token-provider";
import type { ShopifyBootstrapPayload } from "@/lib/shopify-app/bootstrap";

export function ShopifyOnboarding() {
  const { authorizedFetch } = useShopifyAppFetch();
  const [data, setData] = useState<ShopifyBootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authorizedFetch("/api/shopify/bootstrap");
        const json = (await response.json()) as {
          success?: boolean;
          message?: string;
          data?: ShopifyBootstrapPayload;
        };
        if (!response.ok || !json.success || !json.data) {
          throw new Error(json.message || "Unable to load onboarding status.");
        }
        if (!cancelled) setData(json.data);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load onboarding.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizedFetch]);

  if (loading) {
    return (
      <s-page heading="Set up PostBus">
        <s-section>
          <s-spinner accessibilityLabel="Loading onboarding" />
        </s-section>
      </s-page>
    );
  }

  if (error || !data) {
    return (
      <s-page heading="Set up PostBus">
        <s-banner heading="Authorization required" tone="critical">
          {error || "Open PostBus from Shopify Admin."}
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="Set up PostBus">
      <s-section heading="Foundation">
        <s-paragraph>
          Steps 1 and 2 run automatically from this Shopify install. India Post credentials and shipping
          are not collected here.
        </s-paragraph>
        <s-unordered-list>
          {data.nextSteps.map((step) => (
            <s-list-item key={step.id}>
              {step.label}
              {step.status === "complete" ? " — done" : ""}
              {step.status === "upcoming" ? " — coming later" : ""}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
