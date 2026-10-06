import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreApp } from "@/components/storefront/store-app";
import type { StorePayload } from "@/components/storefront/store-types";
import {
  assertStorePublished,
  listPublicProducts,
  loadPublicStorefront,
  organizationFromLink,
  publicStoreClient,
} from "@/modules/storefront/public";

export const dynamic = "force-dynamic";

async function loadCategoryPage(workspace: string, slug: string) {
  const supabase = publicStoreClient();
  const ref = { kind: "path" as const, workspace };
  const organizationId = await organizationFromLink(supabase, ref);
  await assertStorePublished(supabase, organizationId);
  const store = (await loadPublicStorefront(supabase, ref)) as StorePayload;
  const category = store.categories.find((item) => item.slug === slug);
  if (!category) return null;
  store.products = await listPublicProducts(supabase, organizationId, {
    page: 1,
    pageSize: 24,
    categoryId: category.id,
  });
  return { store, category };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspace: string; slug: string }>;
}): Promise<Metadata> {
  const { workspace, slug } = await params;
  const data = await loadCategoryPage(workspace, slug).catch(() => null);
  if (!data) return { title: "Category not found" };
  const description = data.category.description || `Shop ${data.category.name} from ${data.store.storeName}.`;
  return {
    title: `${data.category.name} · ${data.store.storeName}`,
    description,
    alternates: { canonical: `/store/${workspace}/category/${slug}` },
    openGraph: {
      title: `${data.category.name} · ${data.store.storeName}`,
      description,
      images: data.category.imageUrl ? [{ url: data.category.imageUrl }] : undefined,
    },
  };
}

export default async function StoreCategoryPage({
  params,
}: {
  params: Promise<{ workspace: string; slug: string }>;
}) {
  const { workspace, slug } = await params;
  const data = await loadCategoryPage(workspace.toLowerCase(), slug.toLowerCase()).catch(() => null);
  if (!data) notFound();
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: data.store.storeName, item: `/store/${workspace}` },
      { "@type": "ListItem", position: 2, name: data.category.name, item: `/store/${workspace}/category/${slug}` },
    ],
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }}
      />
      <StoreApp
        workspace={workspace}
        initialStore={data.store}
        initialCategoryId={data.category.id}
      />
    </>
  );
}
