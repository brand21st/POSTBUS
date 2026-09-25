import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Understand how an existing India Post Customer ID connects to PostBus for ecommerce shipment booking, labels, barcodes, tracking and shipping management.";

export const metadata: Metadata = marketingMetadata({
  title: "India Post Customer ID Shipping with PostBus",
  description,
  path: "/india-post-customer-id",
  keywords: [
    "India Post Customer ID shipping",
    "India Post Customer ID",
    "India Post shipment booking software",
    "India Post ecommerce shipping",
  ],
});

const faqs = [
  {
    q: "What is an India Post Customer ID?",
    a: "An India Post Customer ID identifies an approved customer account used for contracted services and CEPT shipment booking.",
  },
  {
    q: "Does PostBus issue an India Post Customer ID?",
    a: "No. PostBus works with an India Post Customer ID that the merchant already has. India Post controls account approval and carrier services.",
  },
  {
    q: "What India Post setup does PostBus use?",
    a: "Setup uses the merchant’s Customer ID, CEPT password, service contracts, barcode range and pickup office information.",
  },
  {
    q: "Does connecting PostBus change my India Post account?",
    a: "No. The Customer ID, carrier relationship, contracts and postage billing remain with the merchant and India Post.",
  },
] as const;

export default function IndiaPostCustomerIdPage() {
  return (
    <IntentPage
      eyebrow="India Post Customer ID"
      title="Use your existing India Post Customer ID with PostBus"
      description={description}
      directAnswer="An India Post Customer ID identifies the carrier account your business already uses for CEPT booking and contracted services. PostBus connects to that existing setup; it does not issue or replace an India Post account."
      path="/india-post-customer-id"
      sections={[
        {
          title: "Your carrier account stays yours",
          paragraphs: [
            "PostBus is a management layer for the shipping work around the account. India Post remains responsible for the carrier relationship, services and postage billing.",
          ],
          bullets: [
            "Customer ID and CEPT credentials remain part of your India Post setup",
            "Service contracts and pickup office continue to come from India Post",
            "PostBus does not represent itself as India Post or an account issuer",
          ],
        },
        {
          title: "Why the connection matters",
          paragraphs: [
            "The connected setup lets PostBus organize orders, shipment preparation, barcode allocation, labels and tracking around the account your team already uses.",
          ],
          bullets: [
            "Avoid opening a separate carrier workflow for each order",
            "Use contracted services associated with your setup",
            "Keep booking and AWB status in one ecommerce workspace",
          ],
        },
      ]}
      steps={[
        {
          title: "Confirm your India Post setup",
          description: "Have the Customer ID, CEPT credentials, contracts, barcodes and pickup details ready.",
        },
        {
          title: "Connect in PostBus",
          description: "Enter the required account information in the protected dashboard setup.",
        },
        {
          title: "Add orders",
          description: "Sync Shopify or create manual shipments from other channels.",
        },
        {
          title: "Run the shipping workflow",
          description: "Prepare bookings, labels, manifests and tracking through PostBus.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-shipping",
          label: "India Post shipping software",
          description: "See how PostBus manages the full ecommerce shipping workflow.",
        },
        {
          href: "/shopify-india-post",
          label: "Shopify India Post integration",
          description: "Connect store orders to the Customer ID workflow.",
        },
        {
          href: "/contact",
          label: "Discuss your setup",
          description: "Ask PostBus about connecting an existing India Post account.",
        },
      ]}
    />
  );
}
