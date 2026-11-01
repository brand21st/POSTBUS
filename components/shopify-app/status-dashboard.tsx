"use client";

import { useEffect, useState } from "react";
import { useShopifyAppFetch } from "@/components/shopify-app/token-provider";
import type { ShopifyBootstrapPayload } from "@/lib/shopify-app/bootstrap";

function toneFor(status: ShopifyBootstrapPayload["shippingReadiness"]) {
  if (status === "connected") return "success";
  if (status === "error" || status === "authorization_required") return "critical";
  return "warning";
}

function labelFor(status: ShopifyBootstrapPayload["shippingReadiness"]) {
  switch (status) {
    case "connected":
      return "Connected";
    case "provisioning":
      return "Provisioning";
    case "authorization_required":
      return "Authorization required";
    case "error":
      return "Error";
    default:
      return "Setup required";
  }
}

export function ShopifyStatusDashboard() {
  const { authorizedFetch } = useShopifyAppFetch();
  const [data, setData] = useState<ShopifyBootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authorizedFetch("/api/shopify/bootstrap");
        const json = (await response.json()) as { success?: boolean; message?: string; data?: ShopifyBootstrapPayload };
        if (!response.ok || !json.success || !json.data) {
          throw new Error(json.message || "Unable to load PostBus status.");
        }
        if (!cancelled) setData(json.data);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load PostBus status.");
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
      <s-page heading="PostBus">
        <s-section>
          <s-spinner accessibilityLabel="Loading PostBus" />
        </s-section>
      </s-page>
    );
  }

  if (error || !data) {
    return (
      <s-page heading="PostBus">
        <s-banner heading="Authorization required" tone="critical">
          {error || "Open PostBus from Shopify Admin."}
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="PostBus">
      <s-section heading="India Post shipping automation">
        <s-paragraph>Ship with India Post without leaving Shopify Admin.</s-paragraph>
        <s-banner heading="Application status" tone={toneFor(data.shippingReadiness)}>
          {labelFor(data.shippingReadiness)}
        </s-banner>
      </s-section>
      <s-section heading="Connection">
        <s-stack gap="base">
          <s-text type="strong">Shopify store</s-text>
          <s-text>{data.shopDomain}</s-text>
          <s-text type="strong">Shopify connection</s-text>
          <s-text>{data.installationStatus === "CONNECTED" ? "Connected" : data.installationStatus}</s-text>
          <s-text type="strong">PostBus organization</s-text>
          <s-text>{data.organization.ready ? "Ready" : "Setup required"}</s-text>
          <s-text type="strong">India Post integration</s-text>
          <s-text>{data.indiaPost.configured ? "Configured" : "Not configured"}</s-text>
          <s-text type="strong">Shipping readiness</s-text>
          <s-text>{labelFor(data.shippingReadiness)}</s-text>
        </s-stack>
      </s-section>
      <s-section heading="Next steps">
        <s-unordered-list>
          {data.nextSteps.map((step) => (
            <s-list-item key={step.id}>
              {step.label}
              {step.status === "upcoming" ? " (coming later)" : ""}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
