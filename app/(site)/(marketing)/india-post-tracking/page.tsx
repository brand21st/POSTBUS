import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Manage India Post AWB tracking updates beside ecommerce orders in PostBus, with shipment history and optional Wati WhatsApp notifications on eligible plans.";

export const metadata: Metadata = marketingMetadata({
  title: "India Post Tracking Management for Ecommerce",
  description,
  path: "/india-post-tracking",
  keywords: [
    "India Post tracking management",
    "India Post shipment tracking",
    "India Post AWB tracking",
    "India Post ecommerce shipping automation",
  ],
});

const faqs = [
  {
    q: "Can PostBus track India Post shipments?",
    a: "Yes. PostBus keeps India Post AWB status and shipment history beside the order in the shipping dashboard.",
  },
  {
    q: "What is an AWB in PostBus?",
    a: "The AWB is the shipment tracking identifier associated with a booked India Post consignment. PostBus uses it to organize tracking updates with the order.",
  },
  {
    q: "Can customers receive WhatsApp tracking updates?",
    a: "Optional WhatsApp updates are available through the merchant’s Wati account on the Business plan and during the full-feature trial.",
  },
  {
    q: "Does PostBus control India Post delivery times?",
    a: "No. India Post operates the carrier network and determines shipment movement and delivery. PostBus organizes the tracking information it receives.",
  },
] as const;

export default function IndiaPostTrackingPage() {
  return (
    <IntentPage
      eyebrow="AWB tracking"
      title="Manage India Post tracking beside every ecommerce order"
      description={description}
      directAnswer="PostBus keeps India Post AWB tracking status with the shipment and order. Shipping teams can review booked, in-transit and delivered activity without looking up each consignment in a separate carrier tab."
      path="/india-post-tracking"
      sections={[
        {
          title: "One operational view for the team",
          paragraphs: [
            "Tracking is more useful when it stays connected to the order, label and invoice. PostBus maintains that relationship so teams can understand shipment status in context.",
          ],
          bullets: [
            "Review AWB status beside the original order",
            "Keep shipment history for operational follow-up",
            "Separate booked, in-transit and delivered work",
          ],
        },
        {
          title: "Clearer customer follow-up",
          paragraphs: [
            "When a customer asks where an order is, the team can review the shipment in PostBus instead of manually searching for the AWB in another portal.",
          ],
          bullets: [
            "Reduce repeated one-by-one tracking checks",
            "Use Wati WhatsApp updates on eligible plans",
            "Remember that India Post remains responsible for carrier delivery",
          ],
        },
      ]}
      steps={[
        {
          title: "Book the shipment",
          description: "Prepare the consignment through the connected India Post Customer ID.",
        },
        {
          title: "Associate the AWB",
          description: "Keep the shipment identifier with the order and generated label.",
        },
        {
          title: "Receive status updates",
          description: "Review tracking movement in the PostBus shipment workspace.",
        },
        {
          title: "Follow up in context",
          description: "Use order and tracking history to answer operational or customer questions.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-shipping",
          label: "India Post shipping management",
          description: "See the complete workflow before and after booking.",
        },
        {
          href: "/india-post-shipping-label",
          label: "India Post shipping labels",
          description: "Understand the label and barcode stage before tracking.",
        },
        {
          href: "/pricing",
          label: "PostBus pricing",
          description: "Compare plans and optional Wati notification availability.",
        },
      ]}
    />
  );
}
