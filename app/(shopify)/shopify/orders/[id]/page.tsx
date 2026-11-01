import { ShopifyOrderBookPage } from "@/components/shopify-app/order-book-page";

export default async function ShopifyOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShopifyOrderBookPage orderId={id} />;
}
