import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreApp } from "@/components/storefront/store-app";
import type { StorePayload, StoreProduct } from "@/components/storefront/store-types";
import {
  assertStorePublished,
  getPublicProductBySlug,
  loadPublicStorefront,
  organizationFromLink,
  publicStoreClient,
} from "@/modules/storefront/public";

export const dynamic = "force-dynamic";

async function loadProductPage(workspace: string, slug: string) {
  const supabase = publicStoreClient();
  const ref = { kind: "path" as const, workspace };
  const organizationId = await organizationFromLink(supabase, ref);
  await assertStorePublished(supabase, organizationId);
  const [store, product] = await Promise.all([
    loadPublicStorefront(supabase, ref),
    getPublicProductBySlug(supabase, organizationId, slug),
  ]);
  return { store: store as StorePayload, product: product as StoreProduct };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspace: string; slug: string }>;
}): Promise<Metadata> {
  const { workspace, slug } = await params;
  try {
    const { store, product } = await loadProductPage(workspace, slug);
    const description = product.description || `Buy ${product.name} from ${store.storeName}.`;
    return {
      title: `${product.name} · ${store.storeName}`,
      description,
      alternates: { canonical: `/store/${workspace}/products/${slug}` },
      openGraph: {
        title: product.name,
        description,
        type: "website",
        images: product.imageUrls[0] ? [{ url: product.imageUrls[0] }] : undefined,
      },
    };
  } catch {
    return { title: "Product not found" };
  }
}

export default async function StoreProductPage({
  params,
}: {
  params: Promise<{ workspace: string; slug: string }>;
}) {
  const { workspace, slug } = await params;
  let data: Awaited<ReturnType<typeof loadProductPage>>;
  try {
    data = await loadProductPage(workspace.toLowerCase(), slug.toLowerCase());
  } catch {
    notFound();
  }
  const { store, product } = data;
  if (!store.products.items.some((item) => item.id === product.id)) {
    store.products.items = [product, ...store.products.items];
    store.products.total += 1;
  }
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: product.imageUrls,
    sku: product.sku,
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: product.price,
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `/store/${workspace}/products/${slug}`,
    },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <StoreApp workspace={workspace} initialStore={store} initialProduct={product} />
    </>
  );
}
