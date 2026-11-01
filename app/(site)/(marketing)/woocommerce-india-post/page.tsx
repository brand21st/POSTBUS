import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Learn how WooCommerce merchants can manage India Post shipments manually in PostBus today and what the planned native WooCommerce integration will support.";

export const metadata: Metadata = marketingMetadata({
  title: "WooCommerce India Post Shipping Workflow",
  description,
  path: "/woocommerce-india-post",
  keywords: [
    "India Post WooCommerce shipping",
    "WooCommerce India Post integration",
    "India Post WooCommerce plugin",
    "WooCommerce India Post shipping plugin",
  ],
});

const faqs = [
  {
    q: "Does PostBus have a WooCommerce integration?",
    a: "Not yet. Native WooCommerce integration is planned. PostBus does not currently claim to be a live WooCommerce plugin.",
  },
  {
    q: "Can WooCommerce merchants use PostBus today?",
    a: "Yes. WooCommerce merchants can create manual shipments in PostBus and book them through an existing India Post Customer ID.",
  },
  {
    q: "Will I need an India Post Customer ID?",
    a: "Yes. Both the current manual workflow and the planned native connection rely on the merchant’s existing India Post Customer ID.",
  },
  {
    q: "Can manual WooCommerce shipments use labels and tracking?",
    a: "Yes. Once the order is entered as a manual shipment, it can use PostBus booking, label, barcode and AWB tracking workflows.",
  },
] as const;

export default function WooCommerceIndiaPostPage() {
  return (
    <IntentPage
      eyebrow="WooCommerce workflow"
      title="India Post shipping for WooCommerce orders"
      description={description}
      directAnswer="Native WooCommerce integration is not live yet. Today, WooCommerce merchants can add orders to PostBus as manual shipments and use their existing India Post Customer ID for booking, labels and tracking. A direct WooCommerce connection is on the roadmap."
      path="/woocommerce-india-post"
      sections={[
        {
          title: "What works today",
          paragraphs: [
            "A WooCommerce order can be entered as a manual shipment in PostBus. This keeps the carrier workflow in one place even before native store synchronization is available.",
          ],
          bullets: [
            "Create the shipment from WooCommerce order details",
            "Book with your existing India Post Customer ID",
            "Generate labels and keep AWB tracking in PostBus",
          ],
        },
        {
          title: "What is still planned",
          paragraphs: [
            "Automatic WooCommerce order synchronization is on the roadmap. This page intentionally does not represent the planned connection as a live plugin or installed integration.",
          ],
          bullets: [
            "No claim of automatic WooCommerce order sync today",
            "No separate India Post account is created by PostBus",
            "Contact PostBus if native integration timing affects your workflow",
          ],
        },
      ]}
      steps={[
        {
          title: "Open the WooCommerce order",
          description: "Use the customer, address, item and parcel details from the store order.",
        },
        {
          title: "Create a manual shipment",
          description: "Enter the required shipment details in the PostBus workspace.",
        },
        {
          title: "Book with India Post",
          description: "Use the service and barcode setup connected to your Customer ID.",
        },
        {
          title: "Generate and track",
          description: "Create the shipping label and monitor the India Post AWB in PostBus.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-shipping",
          label: "India Post shipping management",
          description: "Understand the wider order-to-tracking workflow.",
        },
        {
          href: "/india-post-shipping-label",
          label: "India Post shipping labels",
          description: "Learn how labels and barcode allocation work.",
        },
        {
          href: "/contact",
          label: "Ask about WooCommerce",
          description: "Tell PostBus about your store and current shipping process.",
        },
      ]}
    />
  );
}
