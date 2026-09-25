import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Generate and manage India Post shipping labels and barcode allocation in PostBus after preparing shipments with your existing India Post Customer ID.";

export const metadata: Metadata = marketingMetadata({
  title: "India Post Shipping Label Workflow",
  description,
  path: "/india-post-shipping-label",
  keywords: [
    "India Post shipping label",
    "India Post shipping label generator",
    "India Post label printing",
    "India Post shipment booking software",
  ],
});

const faqs = [
  {
    q: "Can PostBus generate India Post shipping labels?",
    a: "Yes. Shipping label generation and barcode allocation are part of the PostBus booking workflow for merchants using an existing India Post Customer ID.",
  },
  {
    q: "Do labels require an India Post Customer ID?",
    a: "Yes. PostBus label workflows are tied to shipments prepared through the merchant’s existing India Post account and barcode setup.",
  },
  {
    q: "Can labels be created for manual orders?",
    a: "Yes. Manual shipments can move through the same booking, barcode and label workflow as supported store orders.",
  },
  {
    q: "Does PostBus also create manifests?",
    a: "Yes. PostBus supports manifest management so pickup-ready shipments can be organized after booking and labeling.",
  },
] as const;

export default function IndiaPostShippingLabelPage() {
  return (
    <IntentPage
      eyebrow="Shipping labels"
      title="Generate India Post shipping labels in your booking workflow"
      description={description}
      directAnswer="PostBus generates shipping labels as part of the India Post shipment workflow. Merchants prepare the order, use the barcode range connected to their existing Customer ID, complete booking and produce the label from the same workspace."
      path="/india-post-shipping-label"
      sections={[
        {
          title: "Labels stay connected to the shipment",
          paragraphs: [
            "Order details, booking status, barcode information and the generated label are handled as parts of one shipment instead of disconnected manual tasks.",
          ],
          bullets: [
            "Use address and parcel details already prepared in PostBus",
            "Manage barcode allocation from the shipping queue",
            "Keep the label associated with its order and AWB",
          ],
        },
        {
          title: "Prepare pickup work in one place",
          paragraphs: [
            "After labels are ready, the same operational workflow can organize multiple shipments and manifests for pickup.",
          ],
          bullets: [
            "Process multiple shipments together on eligible plans",
            "Reduce repeated data entry between order and label steps",
            "Use manifests without rebuilding the shipment list elsewhere",
          ],
        },
      ]}
      steps={[
        {
          title: "Prepare the order",
          description: "Confirm the recipient, address, package and service details.",
        },
        {
          title: "Allocate the barcode",
          description: "Use the barcode setup associated with your India Post account.",
        },
        {
          title: "Complete booking",
          description: "Prepare the shipment through the connected Customer ID workflow.",
        },
        {
          title: "Generate the label",
          description: "Create the shipping label and organize it with the shipment manifest.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-customer-id",
          label: "India Post Customer ID",
          description: "Understand the account and barcode setup behind labels.",
        },
        {
          href: "/india-post-tracking",
          label: "India Post AWB tracking",
          description: "Follow the shipment after the label is created.",
        },
        {
          href: "/features",
          label: "PostBus features",
          description: "Review labels, manifests, invoices and automation features.",
        },
      ]}
    />
  );
}
