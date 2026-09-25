import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";

export const SAMPLE_PACKING_DATA: PackingLabelData = {
  storeName: "Sample Store",
  storePhone: "9876543210",
  storeWebsite: "samplestore.myshopify.com",
  orderNumber: "12345",
  shopifyOrderNumber: "1001",
  orderDate: "2 October 2018",
  items: [
    { title: "Cotton Shirt", sku: "SHIRT-BLK", quantity: 2, unitPrice: 799 },
    { title: "Black Jeans", sku: "JEAN-BLK", quantity: 1, unitPrice: 999 },
  ],
  subtotal: 2597,
  shipping: 0,
  discount: 0,
  total: 2597,
  codAmount: 2597,
  paymentMethod: "COD",
  customerNote: "Please call before delivery.",
  returnAddress: "Sample Store, Kochi, Kerala 682311",
  receiver: {
    name: "Priya Nair",
    phone: "9876501234",
    lines: ["14 Lake View", "Ernakulam, Kerala", "- 682016"],
  },
  sender: {
    name: "Sample Store",
    phone: "9876543210",
    lines: ["12 Market Road", "Kochi, Kerala", "- 682311"],
  },
  billing: {
    name: "Priya Nair",
    phone: "9876501234",
    lines: ["14 Lake View", "Ernakulam, Kerala", "- 682016"],
  },
  logoBytes: null,
  logoMime: null,
};

export async function loadLogoBytes(
  supabase: SupabaseClient,
  logoPath: string | null | undefined
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!logoPath) return null;
  const downloaded = await supabase.storage.from("organization-assets").download(logoPath);
  if (!downloaded.data) return null;
  const mime = downloaded.data.type || "";
  if (!/png|jpe?g/i.test(mime) && !/\.(png|jpe?g)$/i.test(logoPath)) return null;
  return { bytes: new Uint8Array(await downloaded.data.arrayBuffer()), mime: mime || "image/png" };
}
