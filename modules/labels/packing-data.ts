import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";

export const SAMPLE_PACKING_DATA: PackingLabelData = {
  storeName: "Sample Store",
  storePhone: "9876543210",
  storeWebsite: "samplestore.myshopify.com",
  orderNumber: "12345",
  shopifyOrderNumber: "1001",
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
  logoBytes: null,
  logoMime: null,
};

function moneyNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function orderNote(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return "";
  const record = metadata as Record<string, unknown>;
  const note = record.note ?? record.customerNote ?? record.customer_note;
  return typeof note === "string" ? note : "";
}

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

export async function packingDataForOrganization(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId?: string | null
): Promise<{ data: PackingLabelData; sample: boolean; shipmentId: string | null }> {
  let shipmentQuery = supabase
    .from("shipments")
    .select(
      "id, payment_mode, cod_amount, order_id, orders(order_number, source, source_order_id, subtotal, discount, shipping_amount, total_amount, metadata, order_line_items(title, sku, quantity, unit_price))"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (shipmentId) {
    shipmentQuery = supabase
      .from("shipments")
      .select(
        "id, payment_mode, cod_amount, order_id, orders(order_number, source, source_order_id, subtotal, discount, shipping_amount, total_amount, metadata, order_line_items(title, sku, quantity, unit_price))"
      )
      .eq("organization_id", organizationId)
      .eq("id", shipmentId)
      .limit(1);
  }
  const { data: shipments } = await shipmentQuery;
  const shipment = shipments?.[0] as
    | {
        id: string;
        payment_mode?: string | null;
        cod_amount?: number | string | null;
        orders?:
          | {
              order_number?: string | null;
              source?: string | null;
              source_order_id?: string | null;
              subtotal?: number | string | null;
              discount?: number | string | null;
              shipping_amount?: number | string | null;
              total_amount?: number | string | null;
              metadata?: unknown;
              order_line_items?: Array<{
                title?: string;
                sku?: string | null;
                quantity?: number;
                unit_price?: number | string;
              }>;
            }
          | Array<{
              order_number?: string | null;
              source?: string | null;
              source_order_id?: string | null;
              subtotal?: number | string | null;
              discount?: number | string | null;
              shipping_amount?: number | string | null;
              total_amount?: number | string | null;
              metadata?: unknown;
              order_line_items?: Array<{
                title?: string;
                sku?: string | null;
                quantity?: number;
                unit_price?: number | string;
              }>;
            }>
          | null;
      }
    | undefined;

  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode, logo_path")
    .eq("id", organizationId)
    .maybeSingle();
  const { data: pickup } = await supabase
    .from("pickup_locations")
    .select("name, line1, line2, city, state, pincode, phone")
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: shop } = await supabase
    .from("shopify_stores")
    .select("shop_name, shop_domain")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const logo = await loadLogoBytes(supabase, org?.logo_path);
  const returnParts = [
    pickup?.name || org?.name,
    pickup?.line1 || org?.line1,
    pickup?.line2 || org?.line2,
    [pickup?.city || org?.city, pickup?.state || org?.state, pickup?.pincode || org?.pincode]
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);

  if (!shipment) {
    return {
      data: {
        ...SAMPLE_PACKING_DATA,
        storeName: org?.name || shop?.shop_name || SAMPLE_PACKING_DATA.storeName,
        storePhone: org?.phone || pickup?.phone || SAMPLE_PACKING_DATA.storePhone,
        storeWebsite: shop?.shop_domain || SAMPLE_PACKING_DATA.storeWebsite,
        returnAddress: returnParts.join(", ") || SAMPLE_PACKING_DATA.returnAddress,
        logoBytes: logo?.bytes ?? null,
        logoMime: logo?.mime ?? null,
      },
      sample: true,
      shipmentId: null,
    };
  }

  const order = Array.isArray(shipment.orders) ? shipment.orders[0] : shipment.orders;
  const items = (order?.order_line_items ?? []).map((item) => ({
    title: item.title || "Item",
    sku: item.sku ?? null,
    quantity: Number(item.quantity) || 1,
    unitPrice: moneyNumber(item.unit_price),
  }));

  return {
    data: {
      storeName: String(org?.name || shop?.shop_name || "Store"),
      storePhone: String(org?.phone || pickup?.phone || ""),
      storeWebsite: String(shop?.shop_domain || ""),
      orderNumber: String(order?.order_number || ""),
      shopifyOrderNumber:
        String(order?.source || "").toUpperCase() === "SHOPIFY" ? String(order?.source_order_id || "") : "",
      items,
      subtotal: moneyNumber(order?.subtotal),
      shipping: moneyNumber(order?.shipping_amount),
      discount: moneyNumber(order?.discount),
      total: moneyNumber(order?.total_amount),
      codAmount: moneyNumber(shipment.cod_amount),
      paymentMethod: String(shipment.payment_mode || ""),
      customerNote: orderNote(order?.metadata),
      returnAddress: returnParts.join(", "),
      logoBytes: logo?.bytes ?? null,
      logoMime: logo?.mime ?? null,
    },
    sample: false,
    shipmentId: shipment.id,
  };
}
