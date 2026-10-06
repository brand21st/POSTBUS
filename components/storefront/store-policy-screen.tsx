"use client";

import { StoreHeader } from "@/components/storefront/store-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import type { StorePayload } from "@/components/storefront/store-types";

export function StorePolicyScreen({
  store,
  title,
  body,
}: {
  store: StorePayload;
  title: string;
  body: string;
}) {
  return (
    <div className="min-h-dvh w-full min-w-0 bg-zinc-50 text-zinc-950">
      <StoreHeader store={store} showSearch={false} showCart={false} />
      <article className="mx-auto w-full max-w-3xl min-w-0 px-3 py-8 sm:px-5">
        <h1 className="text-2xl font-bold tracking-tight break-words sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{store.storeName}</p>
        <div className="mt-6 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-800 sm:text-base">
          {body}
        </div>
      </article>
      <StorefrontFooter footer={store.footer} />
    </div>
  );
}
