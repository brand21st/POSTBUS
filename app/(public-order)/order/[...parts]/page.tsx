import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseCustomerOrderLinkParts } from "@/modules/customer-order-links/schema";
import { CustomerOrderForm } from "@/components/customer-order/customer-order-form";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share your delivery details",
  description: "Submit your name, mobile number, and address for this PostBus order.",
  ...noIndexMetadata,
};

export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ parts: string[] }>;
}) {
  const { parts } = await params;
  const parsed = parseCustomerOrderLinkParts(parts);
  if (!parsed) notFound();
  return (
    <CustomerOrderForm token={parsed.token} workspace={parsed.workspace} publicId={parsed.publicId} />
  );
}
