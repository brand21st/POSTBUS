import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";
import { organizationLogoStoragePath, organizationLogoUrl } from "@/modules/organizations/branding";

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
    street: "14 Lake View",
    city: "Ernakulam",
    state: "Kerala",
    pincode: "682016",
    country: "India",
  },
  sender: {
    name: "Sample Store",
    phone: "9876543210",
    lines: ["12 Market Road", "Kochi, Kerala", "- 682311"],
    street: "12 Market Road",
    city: "Kochi",
    state: "Kerala",
    pincode: "682311",
    country: "India",
  },
  billing: {
    name: "Priya Nair",
    phone: "9876501234",
    lines: ["14 Lake View", "Ernakulam, Kerala", "- 682016"],
  },
  logoBytes: null,
  logoMime: null,
  logoUrl: null,
};

function logoMimeFor(path: string, mime: string) {
  if (/png/i.test(mime) || /\.png$/i.test(path)) return mime || "image/png";
  if (/jpe?g/i.test(mime) || /\.jpe?g$/i.test(path)) return mime || "image/jpeg";
  if (/webp/i.test(mime) || /\.webp$/i.test(path)) return mime || "image/webp";
  return "";
}

export async function loadLogoBytes(
  supabase: SupabaseClient,
  logoPath: string | null | undefined
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!logoPath) return null;
  const storagePath = organizationLogoStoragePath(logoPath);
  if (storagePath) {
    const downloaded = await supabase.storage.from("organization-assets").download(storagePath);
    if (downloaded.data) {
      const mime = logoMimeFor(storagePath, downloaded.data.type || "");
      if (/png|jpe?g/i.test(mime)) {
        return { bytes: new Uint8Array(await downloaded.data.arrayBuffer()), mime: mime || "image/png" };
      }
    }
  }
  const url = organizationLogoUrl(storagePath ?? logoPath);
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const mime = logoMimeFor(storagePath ?? logoPath, response.headers.get("content-type") || "");
    if (!/png|jpe?g/i.test(mime)) return null;
    return { bytes: new Uint8Array(await response.arrayBuffer()), mime };
  } catch {
    return null;
  }
}
