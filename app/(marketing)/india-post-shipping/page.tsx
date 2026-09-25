import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Manage India Post ecommerce shipping with your existing Customer ID: organize orders, book shipments, generate labels, track AWBs and manage invoices in PostBus.";

export const metadata: Metadata = marketingMetadata({
  title: "India Post Shipping Software for Ecommerce",
  description,
  path: "/india-post-shipping",
  keywords: [
    "India Post shipping",
    "India Post ecommerce shipping",
    "India Post shipping software",
    "India Post shipping management",
    "India Post shipping automation",
  ],
});

const faqs = [
  {
    q: "What is India Post shipping software?",
    a: "India Post shipping software helps ecommerce teams organize the work around India Post shipments, including orders, booking, labels, manifests, AWB tracking and invoices.",
  },
  {
    q: "Does PostBus replace India Post?",
    a: "No. India Post remains the carrier. PostBus is the management workspace that connects to the merchant’s existing India Post Customer ID.",
  },
  {
    q: "Who is PostBus for?",
    a: "PostBus is for ecommerce businesses that already ship through India Post, including Shopify merchants and teams that create shipments manually.",
  },
  {
    q: "Can PostBus manage manual ecommerce orders?",
    a: "Yes. Merchants can create manual shipments for phone, WhatsApp, marketplace or other orders that did not originate in Shopify.",
  },
] as const;

export default function IndiaPostShippingPage() {
  return (
    <IntentPage
      eyebrow="India Post shipping"
      title="India Post shipping management for ecommerce teams"
      description={description}
      directAnswer="PostBus is India Post shipping management software for ecommerce businesses. It connects to an existing India Post Customer ID and brings orders, booking, shipping labels, manifests, AWB tracking, invoices and analytics into one dashboard."
      path="/india-post-shipping"
      sections={[
        {
          title: "Keep India Post as your carrier",
          paragraphs: [
            "PostBus does not ask you to replace India Post or open a second shipping account. Your Customer ID, contracted services, barcode range and pickup office remain part of your India Post setup.",
          ],
          bullets: [
            "Use the India Post Customer ID you already have",
            "Prepare Shopify and manual orders in one queue",
            "Keep booking and tracking status attached to each shipment",
          ],
        },
        {
          title: "Reduce repetitive shipping administration",
          paragraphs: [
            "Manual copy-and-paste work creates delays and avoidable address, weight and service errors. PostBus gives the team one operational view from order intake through delivery tracking.",
          ],
          bullets: [
            "Generate labels and manage barcode workflows",
            "Process shipments in bulk on eligible plans",
            "Create manifests, invoices and shipping analytics",
          ],
        },
      ]}
      steps={[
        {
          title: "Connect your Customer ID",
          description: "Add the India Post account details and shipping setup your business already uses.",
        },
        {
          title: "Bring in orders",
          description: "Sync Shopify orders or create manual shipments for other sales channels.",
        },
        {
          title: "Book and label",
          description: "Prepare India Post shipments, allocate barcodes and generate shipping labels.",
        },
        {
          title: "Track and review",
          description: "Keep AWB updates, invoices and operational analytics beside the shipment.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-customer-id",
          label: "India Post Customer ID",
          description: "Understand what PostBus needs from an existing India Post account.",
        },
        {
          href: "/india-post-shipping-label",
          label: "India Post shipping labels",
          description: "See how labels and barcode allocation fit into the booking workflow.",
        },
        {
          href: "/shopify-india-post",
          label: "Shopify and India Post",
          description: "Move Shopify orders into an India Post shipping workflow.",
        },
      ]}
    />
  );
}
