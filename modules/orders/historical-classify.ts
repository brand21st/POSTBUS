import type { SupabaseClient } from "@supabase/supabase-js";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import {
  classifyStoredShippingAddress,
  validationPatchFromClassification,
  type StoredShippingFields,
} from "@/modules/shopify/shipping-contact";

export type HistoricalClassifyInput = {
  organizationId: string;
  dryRun?: boolean;
  limit?: number;
};

export type HistoricalClassifyRow = {
  addressId: string;
  orderId: string | null;
  booked: boolean;
  previousStatus: string | null;
  nextStatus: string;
  line1Unchanged: true;
};

/**
 * Classify existing address rows in place.
 * Never rewrites street/city/PIN/phone. Never books. Never allocates barcodes.
 * Booked shipment addresses are reported but not updated.
 */
/**
 * On-demand classification for a single legacy NULL row.
 * Writes only validation columns. Never rewrites street/city/PIN/phone/override.
 * Booking still applies shippingAddressBookingBlock afterwards.
 */
export async function ensureLegacyAddressValidation(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    address: StoredShippingFields & { id?: string | null };
  }
) {
  const stored = String(input.address.address_validation_status ?? "").toUpperCase();
  if (stored === "READY" || stored === "NEEDS_REVIEW" || stored === "INVALID") {
    return input.address;
  }
  const classified = classifyStoredShippingAddress(input.address);
  const patch = validationPatchFromClassification(classified, "legacy-on-demand");
  const merged = { ...input.address, ...patch };
  if (!("address_validation_status" in input.address)) {
    return merged;
  }
  const addressId = String(input.address.id ?? "");
  if (!addressId) {
    return merged;
  }
  const snapshot = input.address;
  let write = supabase
    .from("addresses")
    .update(patch)
    .eq("id", addressId)
    .eq("organization_id", input.organizationId)
    .is("address_validation_status", null);
  if (snapshot.line1 != null) write = write.eq("line1", snapshot.line1);
  if (snapshot.city != null) write = write.eq("city", snapshot.city);
  if (snapshot.pincode != null) write = write.eq("pincode", snapshot.pincode);
  if (snapshot.phone != null) write = write.eq("phone", snapshot.phone);
  const { data: persisted, error } = await write
    .select(
      "id, name, phone, original_phone, phone_source, line1, line2, line3, city, state, pincode, country, address_validation_status, address_validation_errors, address_review_required, address_normalization_source, address_normalized_at, address_manual_override, organization_id"
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (persisted) {
    return persisted as StoredShippingFields;
  }
  const { data: current, error: readError } = await supabase
    .from("addresses")
    .select(
      "id, name, phone, original_phone, phone_source, line1, line2, line3, city, state, pincode, country, address_validation_status, address_validation_errors, address_review_required, address_normalization_source, address_normalized_at, address_manual_override, organization_id"
    )
    .eq("id", addressId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) {
    throw new Error("legacy-address-missing-after-classify");
  }
  return current as StoredShippingFields;
}

export async function classifyHistoricalOrganizationAddresses(
  supabase: SupabaseClient,
  input: HistoricalClassifyInput
) {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const { data: addresses, error } = await supabase
    .from("addresses")
    .select(
      "id, name, phone, original_phone, phone_source, line1, line2, line3, city, state, pincode, country, address_validation_status, organization_id"
    )
    .eq("organization_id", input.organizationId)
    .is("address_validation_status", null)
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (addresses ?? []) as Array<StoredShippingFields & { id: string }>;
  const ids = rows.map((row) => row.id);
  const { data: orders } = ids.length
    ? await supabase
        .from("orders")
        .select("id, shipping_address_id")
        .eq("organization_id", input.organizationId)
        .in("shipping_address_id", ids)
    : { data: [] };
  const orderByAddress = new Map(
    ((orders ?? []) as Array<{ id: string; shipping_address_id: string }>).map((row) => [row.shipping_address_id, row.id])
  );
  const orderIds = [...orderByAddress.values()];
  const { data: shipments } = orderIds.length
    ? await supabase
        .from("shipments")
        .select("order_id, status, booked_at")
        .eq("organization_id", input.organizationId)
        .in("order_id", orderIds)
    : { data: [] };
  const bookedOrders = new Set(
    ((shipments ?? []) as Array<{ order_id: string; status?: string | null; booked_at?: string | null }>)
      .filter((row) => Boolean(row.booked_at) || isIndiaPostAcceptedStatus(String(row.status ?? "")))
      .map((row) => row.order_id)
  );

  const results: HistoricalClassifyRow[] = [];
  let updated = 0;
  let skippedBooked = 0;
  for (const address of rows) {
    const orderId = orderByAddress.get(address.id) ?? null;
    const booked = Boolean(orderId && bookedOrders.has(orderId));
    const classified = classifyStoredShippingAddress(address);
    results.push({
      addressId: address.id,
      orderId,
      booked,
      previousStatus: (address.address_validation_status as string | null) ?? null,
      nextStatus: classified.status,
      line1Unchanged: true,
    });
    if (booked) {
      skippedBooked += 1;
      continue;
    }
    if (input.dryRun) continue;
    const { error: updateError } = await supabase
      .from("addresses")
      .update(validationPatchFromClassification(classified, "historical-classify"))
      .eq("id", address.id)
      .eq("organization_id", input.organizationId)
      .is("address_validation_status", null);
    if (updateError) throw new Error(updateError.message);
    updated += 1;
  }

  return {
    organizationId: input.organizationId,
    dryRun: Boolean(input.dryRun),
    scanned: rows.length,
    updated,
    skippedBooked,
    results,
  };
}
