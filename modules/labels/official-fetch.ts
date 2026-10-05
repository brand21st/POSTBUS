import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { persistIndiaPostTokens } from "@/modules/india-post/session";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import {
  indiaPostDomesticLabelPayload,
  indiaPostMobile,
} from "@/modules/india-post/endpoints";
import { cachedOfficeLookup, resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { persistLabelPdf } from "@/modules/labels/persist";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

export function preserveOfficialIndiaPostPdf(pdf: ArrayBuffer | Uint8Array) {
  if (Buffer.isBuffer(pdf)) return pdf;
  if (pdf instanceof ArrayBuffer) return Buffer.from(pdf);
  return Buffer.from(pdf);
}

export async function fetchOfficialIndiaPostLabelPdf(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select("*, orders(order_number), customers(name, phone), addresses:shipping_address_id(*)")
    .eq("id", shipmentId)
    .single();
  if (!shipment?.barcode || !shipment.booked_at) {
    throw Object.assign(new Error("Shipment is not booked."), { code: "VALIDATION_ERROR" });
  }

  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!connection) {
    throw Object.assign(new Error("India Post is not connected."), { code: "PERMANENT_AUTH_ERROR" });
  }

  const address = shipment.addresses as {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
  } | null;
  const destPin = address?.pincode ?? "";
  if (!/^\d{6}$/.test(destPin) || !address?.line1 || !address?.name) {
    throw Object.assign(new Error("Receiver name, address and 6-digit pincode are required for the India Post label."), {
      code: "VALIDATION_ERROR",
    });
  }

  const { data: pickup } = await supabase
    .from("pickup_locations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode, logo_path")
    .eq("id", organizationId)
    .maybeSingle();
  const { data: shop } = await supabase
    .from("shopify_stores")
    .select("shop_name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const sender = organizationLabelSender(org, pickup, shop?.shop_name);
  const provider = indiaPostFromRow(connection);
  const session = await provider.ensureSession();
  if (!session.reused && session.tokens) {
    await persistIndiaPostTokens(supabase, connection, session.tokens);
  }
  const origin = await resolveIndiaPostOrigin(
    cachedOfficeLookup(provider),
    connection,
    {
      ...pickup,
      pincode: sender.pincode || pickup?.pincode,
      city: sender.city || pickup?.city,
      state: sender.state || pickup?.state,
    },
    destPin
  );
  const receiverMobile =
    indiaPostMobile(address.phone) ||
    indiaPostMobile((shipment.customers as { phone?: string } | null)?.phone);
  const senderMobile = indiaPostMobile(sender.phone) || receiverMobile;

  const pdf = await provider.generateLabel({
    payload: [
      indiaPostDomesticLabelPayload({
        customerId: String(connection.bulk_customer_id ?? ""),
        barcode: String(shipment.barcode),
        serviceCode: String(shipment.service_code || DEFAULT_INDIA_POST_SERVICE),
        bookedAt: shipment.booked_at as string | null,
        weightGrams: Number(shipment.weight_grams) || 100,
        lengthCm: Number(shipment.length_cm) || 0,
        widthCm: Number(shipment.width_cm) || 0,
        heightCm: Number(shipment.height_cm) || 0,
        tariff: shipment.tariff_amount as string | number | null,
        bkgRefId: shipment.provider_ref as string | null,
        recipientName: address.name,
        recipientMobile: receiverMobile,
        recipientLine1: address.line1,
        recipientLine2: address.line2,
        recipientCity: address.city ?? "",
        recipientState: address.state ?? "",
        recipientPin: destPin,
        senderName: String(sender.name),
        senderMobile,
        senderLine1: sender.line1,
        senderLine2: sender.line2,
        senderCity: sender.city || origin.city,
        senderState: sender.state || origin.state,
        senderPin: origin.pincode,
        deliveryOfficeName: origin.deliveryOfficeName,
        bookingOfficeName: origin.name,
        bookingOfficePin: origin.pincode,
        paymentMode: shipment.payment_mode as string | null,
        codAmount: shipment.cod_amount as string | number | null,
      }),
    ],
  });

  return { pdf: preserveOfficialIndiaPostPdf(pdf), shipmentId: String(shipment.id) };
}

export function indiaPostLabelRequestError(error: unknown) {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : "India Post label generation failed.";
  const code = (error as { code?: string }).code;
  if (code === "VALIDATION_ERROR") return new AppError(ERROR_CODES.VALIDATION_ERROR, message);
  if (code === "PERMANENT_AUTH_ERROR") {
    return new AppError(ERROR_CODES.INTEGRATION_NOT_CONNECTED, message);
  }
  return new AppError(ERROR_CODES.PROVIDER_ERROR, message);
}

/** Calls CEPT POST /v1/label/create/domestic and stores the returned PDF. */
export async function generateAndStoreOfficialIndiaPostLabelPdf(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentId: string
) {
  const official = await fetchOfficialIndiaPostLabelPdf(supabase, organizationId, shipmentId);
  try {
    const stored = await persistLabelPdf(supabase, {
      organizationId,
      shipmentId: official.shipmentId,
      kind: "INDIA_POST",
      bytes: official.pdf,
    });
    return { ...official, labelId: stored.id };
  } catch (error) {
    logError("LABEL_OFFICIAL_SAVE_FAILED", {
      organizationId,
      shipmentId: official.shipmentId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ...official, labelId: null as string | null };
  }
}
