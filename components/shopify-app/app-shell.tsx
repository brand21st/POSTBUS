"use client";

import { NavMenu } from "@shopify/app-bridge-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { NavigationBridge } from "@/components/shopify-app/app-bridge";
import { ShopifyTokenProvider } from "@/components/shopify-app/token-provider";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Auth and validation errors won't fix themselves; only retry transient failures once.
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status ?? 0;
          return failureCount < 1 && (status === 0 || status >= 500);
        },
      },
    },
  });
}

export function ShopifyAppShell({
  apiKey,
  children,
}: {
  apiKey: string;
  children: ReactNode;
}) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ShopifyTokenProvider apiKey={apiKey}>
      <QueryClientProvider client={queryClient}>
        {/* App Bridge builds the admin nav from plain <a> children; next/link does not apply here. */}
        {/* eslint-disable @next/next/no-html-link-for-pages */}
        <NavMenu>
          <a href="/shopify" rel="home">
            Home
          </a>
          <a href="/shopify/orders">Orders</a>
          <a href="/shopify/settings">Settings</a>
        </NavMenu>
        {/* eslint-enable @next/next/no-html-link-for-pages */}
        <NavigationBridge />
        {children}
      </QueryClientProvider>
    </ShopifyTokenProvider>
  );
}
