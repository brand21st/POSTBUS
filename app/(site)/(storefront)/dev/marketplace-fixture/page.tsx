import { notFound } from "next/navigation";
import { StoreApp } from "@/components/storefront/store-app";
import { marketplaceFixture } from "@/modules/storefront/marketplace-fixture";

export const dynamic = "force-dynamic";

export default async function MarketplaceFixturePage({ searchParams }: { searchParams: Promise<{ empty?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const empty = (await searchParams).empty === "1";
  const store = empty
    ? { ...marketplaceFixture, bundles: [], products: { ...marketplaceFixture.products, items: [], featured: [], bestSellers: [], total: 0 } }
    : marketplaceFixture;
  return <StoreApp preview={store} workspace="samanga" />;
}
