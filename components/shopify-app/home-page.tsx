"use client";

import { useQuery } from "@tanstack/react-query";
import { useShopifyApi, useShopifyAppRoute } from "@/components/shopify-app/api";
import { useAppNavigate } from "@/components/shopify-app/app-bridge";
import { setupChecklist } from "@/components/shopify-app/setup";
import type { IndiaPostSettings, Kpis } from "@/components/shopify-app/types";
import { ErrorBanner, SectionSkeleton } from "@/components/shopify-app/ui";
import type { ShopifyBootstrapPayload } from "@/lib/shopify-app/bootstrap";

const KPI_CARDS: Array<{ key: keyof Kpis; label: string }> = [
  { key: "readyToShip", label: "Ready to ship" },
  { key: "booked", label: "Booked" },
  { key: "inTransit", label: "In transit" },
  { key: "delivered", label: "Delivered" },
  { key: "failed", label: "Needs attention" },
];

export function ShopifyHomePage() {
  const api = useShopifyApi();
  const route = useShopifyAppRoute();
  const navigate = useAppNavigate();

  // Bootstrap first: it verifies the shop, provisions the workspace and starts the first order import.
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => route<ShopifyBootstrapPayload>("bootstrap"),
  });
  const ready = bootstrap.isSuccess;
  const indiaPost = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostSettings>("integrations/india-post"),
    enabled: ready,
  });
  const kpis = useQuery({
    queryKey: ["kpis"],
    queryFn: () => api<Kpis>("dashboard/kpis"),
    enabled: ready,
  });

  if (bootstrap.isError) {
    return (
      <s-page heading="PostBus">
        <ErrorBanner heading="PostBus couldn't open" error={bootstrap.error} onRetry={() => bootstrap.refetch()} />
      </s-page>
    );
  }

  const needsReauth = bootstrap.data?.shippingReadiness === "authorization_required";
  const steps = indiaPost.data ? setupChecklist(indiaPost.data, kpis.data?.booked.value ?? 0) : null;
  const done = steps?.filter((step) => step.done).length ?? 0;

  return (
    <s-page heading="PostBus">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/shopify/orders")}>
        Book orders
      </s-button>

      {needsReauth ? (
        <s-banner tone="warning" heading="Reconnect Shopify">
          <s-paragraph>
            PostBus lost access to your store. Close and reopen the app from Shopify Admin to reconnect. Orders won&apos;t
            sync until then.
          </s-paragraph>
        </s-banner>
      ) : null}

      {!steps ? (
        <SectionSkeleton heading="Get ready to ship" lines={4} />
      ) : done < steps.length ? (
        <s-section heading="Get ready to ship">
          <s-paragraph color="subdued">
            {done} of {steps.length} steps done
          </s-paragraph>
          <s-stack gap="small-300">
            {steps.map((step) => (
              <s-box key={step.id} padding="small-200" borderRadius="base" background={step.done ? "transparent" : "subdued"}>
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type={step.done ? "check-circle" : "circle"} tone={step.done ? "success" : "neutral"} />
                    <s-stack gap="small-500">
                      <s-text type={step.done ? "generic" : "strong"}>{step.label}</s-text>
                      {!step.done ? <s-text color="subdued">{step.help}</s-text> : null}
                    </s-stack>
                  </s-stack>
                  {!step.done ? <s-button onClick={() => navigate(step.href)}>{step.action}</s-button> : null}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {kpis.isError ? (
        <ErrorBanner heading="Couldn't load shipping stats" error={kpis.error} onRetry={() => kpis.refetch()} />
      ) : (
        <s-section heading="Last 30 days">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
            {KPI_CARDS.map((card) => (
              <s-box key={card.key} padding="base" border="base" borderRadius="base">
                <s-stack gap="small-300">
                  <s-text color="subdued">{card.label}</s-text>
                  <s-heading>{kpis.data ? String(kpis.data[card.key]?.value ?? 0) : "–"}</s-heading>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-section>
      )}
    </s-page>
  );
}
