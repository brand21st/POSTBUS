import type { Metadata } from "next";
import { IntentPage } from "@/components/marketing/intent-page";
import { marketingMetadata } from "@/lib/seo/metadata";

const description =
  "Connect your WooCommerce store to India Post with PostBus. Import orders automatically, book with your existing Customer ID, print labels and sync AWB tracking back to WooCommerce.";

export const metadata: Metadata = marketingMetadata({
  title: "WooCommerce India Post Shipping Integration",
  description,
  path: "/woocommerce-india-post",
  keywords: [
    "India Post WooCommerce shipping",
    "WooCommerce India Post integration",
    "India Post WooCommerce plugin",
    "WooCommerce India Post shipping plugin",
    "WooCommerce Speed Post integration",
    "India Post tracking for WooCommerce",
    "WooCommerce shipping label India Post",
    "WordPress India Post shipping",
  ],
});

const faqs = [
  {
    q: "Does PostBus have a WooCommerce integration?",
    a: "Yes. Connect your WooCommerce store with REST API keys and PostBus imports orders automatically, then books them through your existing India Post Customer ID.",
  },
  {
    q: "Do I need to install a WordPress plugin?",
    a: "No. PostBus connects through the WooCommerce REST API using a consumer key and secret you create in WooCommerce settings, so there is nothing extra to install or update on your WordPress site.",
  },
  {
    q: "Which WooCommerce orders are imported?",
    a: "You choose the order statuses to import, such as Processing and On hold. New and updated orders arrive automatically through WooCommerce webhooks, and you can also run an import on demand.",
  },
  {
    q: "Are COD orders supported?",
    a: "Yes. Orders paid with WooCommerce Cash on Delivery are imported as COD with the collectable amount, and refunds are taken into account so the amount to collect stays accurate.",
  },
  {
    q: "Will I need an India Post Customer ID?",
    a: "Yes. PostBus books shipments through the India Post Customer ID you already have. It does not create a separate India Post account or charge India Post postage.",
  },
  {
    q: "Does tracking show up in WooCommerce?",
    a: "Yes. After booking, the India Post AWB and a tracking link are saved to the WooCommerce order. You can also add an order note and let PostBus update the order status as the shipment moves.",
  },
  {
    q: "Can I use WooCommerce and Shopify together?",
    a: "Yes. Orders from WooCommerce, Shopify and manual entry are managed in the same PostBus workspace, so one team can book and track every India Post shipment from one queue.",
  },
  {
    q: "What if an order is missing weight or address details?",
    a: "PostBus converts product weights from your store’s weight unit and checks addresses and pincodes before booking, so issues can be fixed in PostBus before the shipment reaches India Post.",
  },
] as const;

export default function WooCommerceIndiaPostPage() {
  return (
    <IntentPage
      eyebrow="WooCommerce integration"
      title="India Post shipping for WooCommerce stores"
      description={description}
      directAnswer="PostBus is a WooCommerce India Post shipping integration. Add your store URL and WooCommerce REST API keys, choose which order statuses to import, and orders flow into PostBus automatically. Book them with your existing India Post Customer ID, print shipping labels, and the AWB and tracking link are saved back to each WooCommerce order."
      path="/woocommerce-india-post"
      sections={[
        {
          title: "Stop copying WooCommerce orders by hand",
          paragraphs: [
            "Typing customer names, addresses, pincodes and weights from WooCommerce into a separate India Post booking screen is slow and error-prone. PostBus pulls those details in for you, so the shipping team starts from a ready-to-book queue.",
          ],
          bullets: [
            "Automatic order import for the statuses you choose",
            "Weights converted from your store’s unit setting",
            "COD amounts and refunds carried over correctly",
          ],
        },
        {
          title: "Book India Post shipments in bulk",
          paragraphs: [
            "Select WooCommerce orders and book them through your existing India Post Customer ID, with barcodes allocated and shipping labels generated in the same workflow.",
          ],
          bullets: [
            "Book with the Customer ID you already use",
            "Speed Post and other services on your contract",
            "Bulk booking and label printing on eligible plans",
          ],
        },
        {
          title: "Tracking that customers can see in WooCommerce",
          paragraphs: [
            "Once a shipment is booked, PostBus writes the India Post AWB and a tracking link back to the WooCommerce order, so your team and your customers are not left asking where a parcel is.",
          ],
          bullets: [
            "AWB and tracking link saved to the order",
            "Optional order notes with the tracking link",
            "Optional order status updates as shipments move",
          ],
        },
        {
          title: "Simple, secure connection",
          paragraphs: [
            "PostBus connects through the official WooCommerce REST API. There is no WordPress plugin to install, and incoming webhooks are signed so only your store can send order updates.",
          ],
          bullets: [
            "No plugin to install or keep updated",
            "Signed WooCommerce webhooks",
            "Imported orders stay in PostBus if you disconnect",
          ],
        },
      ]}
      steps={[
        {
          title: "Create WooCommerce API keys",
          description: "In WooCommerce → Settings → Advanced → REST API, create a Read/Write key.",
        },
        {
          title: "Connect your store",
          description: "Paste your store URL, consumer key and secret into PostBus integrations.",
        },
        {
          title: "Import orders",
          description: "Pick the order statuses to import. New orders then arrive automatically.",
        },
        {
          title: "Book, label and track",
          description: "Book with your India Post Customer ID; the AWB and tracking link sync back to WooCommerce.",
        },
      ]}
      faqs={faqs}
      relatedLinks={[
        {
          href: "/india-post-customer-id",
          label: "India Post Customer ID",
          description: "Learn which existing account details connect to PostBus.",
        },
        {
          href: "/india-post-shipping-label",
          label: "India Post shipping labels",
          description: "Learn how labels and barcode allocation work.",
        },
        {
          href: "/india-post-tracking",
          label: "India Post tracking management",
          description: "Keep AWB status attached to every WooCommerce order.",
        },
      ]}
    />
  );
}
