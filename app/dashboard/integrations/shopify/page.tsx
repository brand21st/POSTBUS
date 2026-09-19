"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import type { IntegrationsResponse } from "@/types/api";

export default function ShopifyIntegrationPage() {
  const [shop, setShop] = useState("");
  const query = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api<IntegrationsResponse>("/api/v1/integrations"),
  });
  const status = query.data?.shopify?.status ?? "NOT_CONNECTED";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shopify"
        description="Connect a store through the PostBus Shopify app. Merchants do not enter app credentials."
      />
      <Card>
        <CardHeader>
          <CardTitle>Store connection</CardTitle>
          <CardDescription>
            Status: {status}. If the PostBus Shopify app is not configured on the server, this
            stays Not Connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shop">Shop domain</Label>
            <Input
              id="shop"
              placeholder="your-store.myshopify.com"
              value={shop}
              onChange={(event) => setShop(event.target.value)}
            />
          </div>
          <Button
            disabled={!shop}
            onClick={() => {
              const href = `${window.location.origin}/api/v1/integrations/shopify/connect?shop=${encodeURIComponent(shop)}`;
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Shopify OAuth must leave the app
              window.location.assign(href);
            }}
          >
            Connect Shopify
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
