"use client";

import { useEffect, useState } from "react";
import { StoreApp } from "@/components/storefront/store-app";
import { StoreSkeleton } from "@/components/storefront/store-skeleton";
import type { StorePayload } from "@/components/storefront/store-types";
import { isStorePreviewMessage, STORE_PREVIEW_READY } from "@/modules/storefront/preview";

export function StorePreviewFrame() {
  const [store, setStore] = useState<StorePayload | null>(null);

  useEffect(() => {
    const parent = window.parent;
    if (parent === window) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== parent) return;
      if (isStorePreviewMessage(event.data)) setStore(event.data.store);
    }
    // Store links point at the live store, which refuses to be framed; keep the preview in place.
    function onClick(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      event.preventDefault();
      const url = new URL(anchor.getAttribute("href") ?? "", window.location.href);
      if (url.origin === window.location.origin && url.hash) {
        document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: "smooth" });
      } else if (url.protocol === "https:" || url.protocol === "http:") {
        window.open(url.href, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("message", onMessage);
    document.addEventListener("click", onClick, true);
    parent.postMessage({ type: STORE_PREVIEW_READY }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  if (!store) return <StoreSkeleton />;
  return <StoreApp preview={store} workspace={store.workspace} />;
}
