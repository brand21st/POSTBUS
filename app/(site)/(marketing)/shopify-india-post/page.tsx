import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Connect Shopify orders to your existing India Post Customer ID workflow with PostBus for booking, labels, AWB tracking, invoices and shipping management.";

export const metadata: Metadata = marketingMetadata({
  title: "Shopify India Post Shipping Integration",
  description,
  path: "/shopify-india-post",
  keywords: [
    "India Post Shopify shipping",
    "Shopify India Post integration",
    "India Post Shopify app",
    "Shopify India Post shipping",
  ],
});

const faqs = [
  {
    q: "Can I use India Post shipping with Shopify?",
    a: "Yes. PostBus can sync Shopify orders into a shipping workspace where you prepare those orders through your existing India Post Customer ID workflow.",
  },
  {
    q: "Do I still need an India Post Customer ID?",
    a: "Yes. Shopify supplies the order data, while your existing India Post Customer ID supplies the carrier account and contracted shipping setup.",
  },
  {
    q: "Does PostBus generate labels for Shopify orders?",
    a: "Yes. After preparing and booking a Shopify order through the India Post workflow, PostBus supports shipping label and barcode steps in the same workspace.",
  },
  {
    q: "Can I mix Shopify and manual orders?",
    a: "Yes. Shopify orders and manually created shipments can be managed together in PostBus.",
  },
] as const;

export default function ShopifyIndiaPostPage() {
  return (
    <IntentPage
      eyebrow="Shopify integration"
      title="Ship Shopify orders with India Post from one workspace"
      description={description}
      directAnswer="PostBus connects Shopify order management with India Post shipping. Shopify orders flow into PostBus, where merchants use their existing India Post Customer ID to prepare bookings, generate labels, monitor AWB tracking and manage invoices."
      path="/shopify-india-post"
      sections={[
        {
          title: "Connect the store to the shipping queue",
          paragraphs: [
            "Instead of copying customer and order details from Shopify into a separate carrier workflow, bring orders into PostBus and prepare them for India Post from the same operational queue.",
          ],
          bullets: [
            "Keep new and updated Shopify orders organized",
            "Review shipment details before India Post booking",
            "Manage store orders and manual shipments together",
          ],
        },
        {
          title: "Keep fulfillment status understandable",
          paragraphs: [
            "Booking, label and tracking information stays associated with the order. That gives shipping teams a clearer view of what is ready, booked, in transit or delivered.",
          ],
          bullets: [
            "India Post label and barcode workflows",
            "AWB tracking beside the Shopify order",
            "Invoices, manifests and analytics in PostBus",
          ],
        },
      ]}
      steps={[
        {
          title: "Connect Shopify",
          description: "Authorize your store so orders can flow into the PostBus workspace.",
        },
        {
          title: "Connect India Post",
          description: "Use the Customer ID, service contracts and barcode setup you already have.",
        },
        {
          title: "Prepare fulfillment",
          description: "Check order details, choose the appropriate service and book the shipment.",
        },
        {
          title: "Label and track",
          description: "Generate the label and keep India Post AWB updates connected to the order.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-shipping",
          label: "India Post ecommerce shipping",
          description: "See the full PostBus shipping management workflow.",
        },
        {
          href: "/india-post-customer-id",
          label: "India Post Customer ID",
          description: "Learn which existing account details connect to PostBus.",
        },
        {
          href: "/india-post-tracking",
          label: "India Post tracking management",
          description: "Keep AWB status attached to every shipment.",
        },
      ]}
    />
  );
}
