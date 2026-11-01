"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

/** App Bridge toast; a no-op outside Shopify Admin (e.g. tests). */
export function showToast(message: string, options?: { isError?: boolean }) {
  if (typeof window === "undefined") return;
  window.shopify?.toast?.show(message, { isError: options?.isError ?? false, duration: 4000 });
}

/** Client-side navigation inside the embedded app. */
export function useAppNavigate() {
  const router = useRouter();
  return useCallback((href: string) => router.push(href), [router]);
}

/**
 * App Bridge dispatches `shopify:navigate` when the merchant uses the admin nav; route it through
 * Next so pages switch without a full iframe reload.
 */
export function NavigationBridge() {
  const router = useRouter();
  useEffect(() => {
    function onNavigate(event: Event) {
      const target = event.target as HTMLElement | null;
      const href = target?.getAttribute?.("href");
      if (href && href.startsWith("/shopify")) router.push(href);
    }
    document.addEventListener("shopify:navigate", onNavigate);
    return () => document.removeEventListener("shopify:navigate", onNavigate);
  }, [router]);
  return null;
}
