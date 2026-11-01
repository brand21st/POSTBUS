import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseCustomerOrderLinkParts } from "@/modules/customer-order-links/schema";
import { StoreApp } from "@/components/storefront/store-app";
import type { StorePayload } from "@/components/storefront/store-types";
import { noIndexMetadata } from "@/lib/seo/metadata";
import { loadPublicStorefront, publicStoreClient } from "@/modules/storefront/public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop",
  description: "Browse products and place your order.",
  ...noIndexMetadata,
};

export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ parts: string[] }>;
}) {
  const { parts } = await params;
  const parsed = parseCustomerOrderLinkParts(parts);
  if (!parsed?.workspace && !parsed?.token) notFound();
  let initialStore: StorePayload | null = null;
  try {
    initialStore = (await loadPublicStorefront(
      publicStoreClient(),
      parsed.token
        ? { kind: "token", token: parsed.token }
        : { kind: "path", workspace: parsed.workspace ?? "", publicId: parsed.publicId }
    )) as StorePayload;
  } catch {
    // Client retry handles a missing or unpublished store.
  }
  return (
    <StoreApp
      workspace={parsed.workspace}
      publicId={parsed.publicId}
      token={parsed.token}
      initialStore={initialStore}
    />
  );
}
