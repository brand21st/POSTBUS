import type { SupabaseClient } from "@supabase/supabase-js";
import { allocateNextBarcode } from "@/modules/india-post/allocate-barcode";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { assertValidatedArticle } from "@/modules/india-post/article-validator";
import { applyWorkspaceParcelDefaults, parcelDefaultsFromConnection } from "@/modules/india-post/parcel-defaults";
import { indiaPostBookingTransport } from "@/modules/india-post/booking-batch";
import { serializeIndiaPostBookingArticle } from "@/modules/india-post/booking-payload";
import { splitIndiaPostBookingResult } from "@/modules/india-post/booking-apply";
import { indiaPostMobile } from "@/modules/india-post/endpoints";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { cachedOfficeLookup, resolveIndiaPostOrigin } from "@/modules/india-post/origin";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { persistIndiaPostTokens } from "@/modules/india-post/session";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

type Admin = SupabaseClient;

export async function markShipmentBookingFailed(
  supabase: Admin,
  shipmentId: string,
  message: string,
  code = "VALIDATION_ERROR"
) {
  await supabase
    .from("shipments")
    .update({ status: "FAILED", last_error: message, last_error_code: code })
    .eq("id", shipmentId);
}

export async function runIndiaPostBooking(
  supabase: Admin,
  input: {
    organizationId: string;
    shipmentIds: string[];
  }
) {
  const { data: connection } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!connection || connection.status === "NOT_CONNECTED") {
    throw Object.assign(new Error("India Post is not connected."), { code: "PERMANENT_AUTH_ERROR" });
  }

  const { data: shipments } = await supabase
    .from("shipments")
    .select("*, orders(*), customers(*), addresses:shipping_address_id(*)")
    .eq("organization_id", input.organizationId)
    .in("id", input.shipmentIds);
  if (!shipments?.length) {
    throw Object.assign(new Error("Shipment not found."), { code: "VALIDATION_ERROR" });
  }

  const alreadyBooked = shipments.filter((row) => isIndiaPostAcceptedStatus(row.status) && row.barcode);
  const pending = shipments.filter((row) => !isIndiaPostAcceptedStatus(row.status));
  if (!pending.length) return { booked: alreadyBooked.length, failed: 0, bookedIds: [], failedIds: [] };

  const { data: pickup } = await supabase
    .from("pickup_locations")
    .select("*")
    .eq("organization_id", input.organizationId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, phone, line1, line2, city, state, pincode")
    .eq("id", input.organizationId)
    .maybeSingle();
  const { data: shop } = await supabase
    .from("shopify_stores")
    .select("shop_name")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const senderIdentity = organizationLabelSender(org, pickup, shop?.shop_name);

  const { data: contracts } = await supabase
    .from("india_post_contracts")
    .select("service_code, contract_id")
    .eq("organization_id", input.organizationId)
    .eq("is_active", true);
  const contractByService = new Map(
    (contracts ?? []).map((row) => [String(row.service_code), String(row.contract_id)])
  );

  const provider = indiaPostFromRow(connection);
  const offices = cachedOfficeLookup(provider);
  const session = await provider.ensureSession();
  if (!session.reused && session.tokens) {
    await persistIndiaPostTokens(supabase, connection, session.tokens);
  }

  const prepared: Array<{
    shipment: (typeof pending)[number];
    barcode: string;
    payload: Record<string, string | number>;
    persistDefaults: { dims: boolean; weight: boolean };
  }> = [];

  for (const shipment of pending) {
    const serviceCode = (shipment.service_code as string) || DEFAULT_INDIA_POST_SERVICE;
    const contractId = contractByService.get(serviceCode) || connection.contract_id;
    if (!contractId) {
      const message = `No India Post contract is set for ${serviceCode}. Add it on the India Post integration page.`;
      await markShipmentBookingFailed(supabase, shipment.id, message, "INVALID_CONTRACT");
      throw Object.assign(new Error(message), { code: "INVALID_CONTRACT" });
    }

    let barcode = String(shipment.barcode ?? "").trim().toUpperCase();
    if (!barcode) {
      barcode = await allocateNextBarcode(supabase, {
        organizationId: input.organizationId,
        serviceCode,
        environment: connection.environment,
      });
      await supabase.from("shipments").update({ status: "BOOKING", barcode }).eq("id", shipment.id);
    } else if (shipment.status !== "BOOKING") {
      await supabase.from("shipments").update({ status: "BOOKING" }).eq("id", shipment.id);
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
    const destPincode = address?.pincode ?? "";
    const origin = await resolveIndiaPostOrigin(
      offices,
      connection,
      {
        ...pickup,
        pincode: senderIdentity.pincode || pickup?.pincode,
        city: senderIdentity.city || pickup?.city,
        state: senderIdentity.state || pickup?.state,
      },
      destPincode
    );
    const senderMobile = indiaPostMobile(senderIdentity.phone);
    const receiverMobile = indiaPostMobile(address?.phone);
    const missingDims = !(
      Number(shipment.length_cm) > 0 &&
      Number(shipment.width_cm) > 0 &&
      Number(shipment.height_cm) > 0
    );
    const missingWeight = !(Number(shipment.weight_grams) > 0);
    const draft = applyWorkspaceParcelDefaults(
      mapShipmentToArticle({
      orderId: shipment.order_id,
      orderNumber: (shipment.orders as { order_number?: string } | null)?.order_number,
      shipmentId: shipment.id,
      serviceCode,
      customerId: String(connection.bulk_customer_id ?? ""),
      contractId: String(contractId),
      barcode,
      officeId: origin.officeId,
      originPin: origin.pincode,
      weightGrams: Number(shipment.weight_grams) || 0,
      lengthCm: Number(shipment.length_cm) || 0,
      widthCm: Number(shipment.width_cm) || 0,
      heightCm: Number(shipment.height_cm) || 0,
      senderName: senderIdentity.name,
      senderCompany: org?.name || pickup?.name || senderIdentity.name,
      senderLine1: senderIdentity.line1,
      senderLine2: senderIdentity.line2,
      senderCity: senderIdentity.city || origin.city,
      senderState: senderIdentity.state || origin.state,
      senderPin: origin.pincode,
      senderMobile: senderMobile || "",
      receiverName: address?.name ?? "",
      receiverCompany: address?.name ?? "",
      receiverLine1: address?.line1 ?? "",
      receiverLine2: address?.line2 ?? "",
      receiverCity: address?.city ?? "",
      receiverState: address?.state ?? "",
      receiverPin: destPincode,
      receiverMobile: receiverMobile || "",
      paymentMode: shipment.payment_mode,
      codAmount: Number(shipment.cod_amount) || 0,
      strictWeight: true,
      strictDimensions: true,
    }),
      parcelDefaultsFromConnection(connection)
    );
    try {
      const validated = assertValidatedArticle(draft);
      prepared.push({
        shipment,
        barcode,
        payload: serializeIndiaPostBookingArticle(validated),
        persistDefaults: { dims: missingDims, weight: missingWeight },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed.";
      await markShipmentBookingFailed(supabase, shipment.id, message);
      if (pending.length === 1) throw Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
    }
  }

  if (!prepared.length) {
    throw Object.assign(new Error("No articles passed validation."), { code: "VALIDATION_ERROR" });
  }

  const { logInfo } = await import("@/lib/logger");
  for (const item of prepared) {
    const orderData = item.shipment.orders as { id?: string; source?: string } | null;
    logInfo("india_post.booking.dispatch", {
      source: String(orderData?.source || "UNKNOWN").toUpperCase(),
      orderId: item.shipment.order_id,
      shipmentId: item.shipment.id,
      weightGrams: item.payload.physical_weight,
      lengthCm: item.payload.length,
      widthCm: item.payload.breadth_diameter,
      heightCm: item.payload.height,
      breadthDiameter: item.payload.breadth_diameter,
      shapeOfArticle: item.payload.shape_of_article,
      serviceCode: item.shipment.service_code,
    });
  }

  const transport = indiaPostBookingTransport(prepared.length);
  const articles = prepared.map((item) => item.payload);
  const result =
    transport === "file"
      ? await provider.bookShipmentFile(articles)
      : await provider.bookShipment({ articles });
  const split = splitIndiaPostBookingResult(result);
  const bookedIds: string[] = [];
  const failedIds: string[] = [];

  const bookedAt = new Date().toISOString();
  await Promise.all(
    prepared.map(async (item) => {
      const key = item.barcode.toUpperCase();
      const ok = split.valid.get(key);
      if (ok) {
        bookedIds.push(item.shipment.id);
        await supabase
          .from("shipments")
          .update({
            status: "BOOKED",
            tracking_number: ok.articleId,
            barcode: ok.articleId,
            tariff_amount: ok.tariff ?? null,
            provider_ref: split.batchId,
            correlation_id: split.correlationId,
            booked_at: bookedAt,
            last_error: null,
            last_error_code: null,
            ...(item.persistDefaults.dims
              ? {
                  length_cm: item.payload.length,
                  width_cm: item.payload.breadth_diameter,
                  height_cm: item.payload.height,
                }
              : {}),
            ...(item.persistDefaults.weight ? { weight_grams: item.payload.physical_weight } : {}),
          })
          .eq("id", item.shipment.id);
        await supabase.from("orders").update({ status: "BOOKED" }).eq("id", item.shipment.order_id);
        return;
      }
      failedIds.push(item.shipment.id);
      const message = split.failed.get(key) || "Booking rejected.";
      await markShipmentBookingFailed(supabase, item.shipment.id, message, "INDIA_POST_VALIDATION");
      if (prepared.length === 1) {
        throw Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
      }
    })
  );

  return { booked: bookedIds.length, failed: failedIds.length, bookedIds, failedIds, prepared, result };
}
