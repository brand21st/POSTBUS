"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { IntegrationCard, IntegrationsResponse } from "@/types/api";

const FALLBACK: IntegrationCard[] = [
  { provider: "SHOPIFY", name: "Shopify", status: "NOT_CONNECTED" },
  { provider: "INDIA_POST", name: "India Post", status: "NOT_CONNECTED" },
  { provider: "WOOCOMMERCE", name: "WooCommerce", status: "NOT_CONNECTED", comingLater: true },
  { provider: "VACHAT", name: "Vachat", status: "NOT_CONNECTED", comingLater: true },
  { provider: "WHATSAPP", name: "WhatsApp", status: "NOT_CONNECTED", comingLater: true },
];

function cardsFromPayload(payload?: IntegrationsResponse | null): IntegrationCard[] {
  if (!payload) return FALLBACK;
  const incoming = payload.items ?? payload.integrations ?? [];
  const byProvider = new Map(incoming.map((item) => [item.provider.toUpperCase(), item]));
  if (payload.shopify) byProvider.set("SHOPIFY", { ...payload.shopify, provider: "SHOPIFY", name: "Shopify" });
  if (payload.indiaPost || payload.india_post) {
    const india = payload.indiaPost ?? payload.india_post;
    byProvider.set("INDIA_POST", { ...india, provider: "INDIA_POST", name: "India Post" });
  }
  return FALLBACK.map((item) => ({ ...item, ...byProvider.get(item.provider) }));
}

export default function IntegrationsPage() {
  const query = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/v1/integrations"),
  });

  const cards = cardsFromPayload(query.data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Shopify and India Post are live. Everything else is reserved and stays not connected."
      />

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={Plug}
          title="Could not load integrations"
          description={query.error instanceof Error ? query.error.message : "Try again shortly."}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((card) => {
            const comingLater = card.comingLater || card.coming_later;
            const connected = (card.status ?? "").toUpperCase() === "CONNECTED";
            const href =
              card.provider === "INDIA_POST"
                ? "/dashboard/integrations/india-post"
                : card.provider === "SHOPIFY"
                  ? "/dashboard/integrations/shopify"
                  : undefined;

            return (
              <Card key={card.provider}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{card.name ?? card.provider}</CardTitle>
                      <CardDescription className="mt-1">
                        {comingLater
                          ? "Coming later. Schema is reserved so this can connect without rewriting orders."
                          : card.lastError || card.last_error
                            ? card.lastError ?? card.last_error
                            : connected
                              ? "Connected and ready for background jobs."
                              : "Not connected."}
                      </CardDescription>
                    </div>
                    <StatusBadge value={comingLater ? "COMING_LATER" : card.status ?? "NOT_CONNECTED"} />
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <p className="text-xs text-muted">
                    Last sync {formatDate(card.lastSyncAt ?? card.last_sync_at, true)}
                  </p>
                  {comingLater ? (
                    <span className="text-sm text-muted">Coming later</span>
                  ) : href?.startsWith("/api") ? (
                    <a href={href} className={buttonVariants({ size: "sm" })}>
                      {connected ? "Manage" : "Connect"}
                    </a>
                  ) : href ? (
                    <Link href={href} className={buttonVariants({ size: "sm" })}>
                      {connected || card.appConfigured === false ? "Configure" : "Connect"}
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
