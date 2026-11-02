import type { SupabaseClient } from "@supabase/supabase-js";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";

export type MatchedOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  createdAt: string;
  customerName: string | null;
  total: number | null;
};

function digitsOf(value?: string | null) {
  return extractIndiaMobileDigits(value);
}

export async function matchOrdersInOrganization(
  supabase: SupabaseClient,
  organizationId: string,
  phoneDigits: string
) {
  const needle = extractIndiaMobileDigits(phoneDigits);
  if (!needle) return [] as MatchedOrder[];

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("organization_id", organizationId);

  const customerIds = (customers ?? [])
    .filter((row) => digitsOf(row.phone) === needle)
    .map((row) => row.id);

  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, phone")
    .eq("organization_id", organizationId);

  const addressIds = (addresses ?? [])
    .filter((row) => digitsOf(row.phone) === needle)
    .map((row) => row.id);

  let query = supabase
    .from("orders")
    .select("id, order_number, status, payment_status, fulfillment_status, created_at, total_amount, customers(name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (customerIds.length && addressIds.length) {
    query = query.or(`customer_id.in.(${customerIds.join(",")}),shipping_address_id.in.(${addressIds.join(",")})`);
  } else if (customerIds.length) {
    query = query.in("customer_id", customerIds);
  } else if (addressIds.length) {
    query = query.in("shipping_address_id", addressIds);
  } else {
    return [];
  }

  const { data } = await query;
  return (data ?? []).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      paymentStatus: row.payment_status,
      fulfillmentStatus: row.fulfillment_status,
      createdAt: row.created_at,
      customerName: customer?.name ?? null,
      total: row.total_amount ?? null,
    } satisfies MatchedOrder;
  });
}
