import type { Metadata } from "next";
import { cache } from "react";
import { StoreApp } from "@/components/storefront/store-app";
import type { StorePayload } from "@/components/storefront/store-types";
import { loadPublicStorefront, publicStoreClient } from "@/modules/storefront/public";

export const dynamic = "force-dynamic";

const loadStore = cache(async (workspace: string) =>
  loadPublicStorefront(publicStoreClient(), { kind: "path", workspace })
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspace: string }>;
}): Promise<Metadata> {
  const workspace = (await params).workspace.toLowerCase();
  try {
    const store = await loadStore(workspace);
    const image = store.slides[0]?.imageUrl || store.logoUrl || undefined;
    const description = store.seoDescription || `Browse products and order directly from ${store.storeName}.`;
    return {
      title: store.seoTitle || `${store.storeName} · Shop`,
      description,
      alternates: { canonical: `/store/${workspace}` },
      openGraph: {
        title: store.seoTitle || store.storeName,
        description,
        type: "website",
        url: `/store/${workspace}`,
        images: image ? [{ url: image }] : undefined,
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title: store.seoTitle || store.storeName,
        description,
        images: image ? [image] : undefined,
      },
    };
  } catch {
    return {
      title: "Shop",
      description: "Browse products and place your order.",
    };
  }
}

export default async function PublicStorePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const workspace = (await params).workspace.toLowerCase();
  let initialStore: StorePayload | null = null;
  try {
    initialStore = (await loadStore(workspace)) as StorePayload;
  } catch {
    // The client retry state handles transient provider failures.
  }
  const structuredData = initialStore
    ? {
        "@context": "https://schema.org",
        "@type": "OnlineStore",
        name: initialStore.storeName,
        url: `/store/${workspace}`,
        logo: initialStore.logoUrl || undefined,
        description: initialStore.seoDescription || undefined,
      }
    : null;
  return (
    <>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
      ) : null}
      <StoreApp workspace={workspace} initialStore={initialStore} />
    </>
  );
}
