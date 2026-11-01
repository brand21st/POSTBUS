import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StorePolicyScreen } from "@/components/storefront/store-policy-screen";
import type { StorePayload } from "@/components/storefront/store-types";
import { getPublicStorePolicy, isStorePolicySlug, publicStoreClient } from "@/modules/storefront/public";
import { STORE_POLICY_TITLES } from "@/modules/storefront/footer";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspace: string; policy: string }>;
}): Promise<Metadata> {
  const { workspace, policy } = await params;
  if (!isStorePolicySlug(policy)) return { title: "Not found" };
  try {
    const page = await getPublicStorePolicy(publicStoreClient(), workspace.toLowerCase(), policy);
    const description = page.body.slice(0, 160);
    return {
      title: `${page.title} · ${page.store.storeName}`,
      description,
      alternates: { canonical: `/store/${workspace}/${policy}` },
      openGraph: {
        title: `${page.title} · ${page.store.storeName}`,
        description,
        type: "article",
        url: `/store/${workspace}/${policy}`,
      },
    };
  } catch {
    return { title: STORE_POLICY_TITLES[policy] };
  }
}

export default async function StorePolicyPage({
  params,
}: {
  params: Promise<{ workspace: string; policy: string }>;
}) {
  const { workspace, policy } = await params;
  if (!isStorePolicySlug(policy)) notFound();
  let page: Awaited<ReturnType<typeof getPublicStorePolicy>>;
  try {
    page = await getPublicStorePolicy(publicStoreClient(), workspace.toLowerCase(), policy);
  } catch {
    notFound();
  }
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
    url: `/store/${workspace}/${policy}`,
    isPartOf: {
      "@type": "OnlineStore",
      name: page.store.storeName,
      url: `/store/${workspace}`,
    },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <StorePolicyScreen store={page.store as StorePayload} title={page.title} body={page.body} />
    </>
  );
}
