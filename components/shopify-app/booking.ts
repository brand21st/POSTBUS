import { SERVICE_OPTIONS, isShipmentActive, positiveNumber } from "@/components/shopify-app/format";
import type { IndiaPostSettings, OrderDetail } from "@/components/shopify-app/types";

export type ParcelForm = {
  serviceCode: string;
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

/** Services the merchant can actually book: those with an active India Post contract. */
export function bookableServices(settings: IndiaPostSettings) {
  const contracted = new Set(
    settings.contracts.filter((contract) => contract.isActive !== false && contract.contractId).map((c) => c.serviceCode)
  );
  return SERVICE_OPTIONS.filter((option) => contracted.has(option.code));
}

function lineItemsWeight(order: OrderDetail) {
  let total = 0;
  for (const item of order.lineItems ?? []) {
    if (!item.weight_grams) return null;
    total += item.weight_grams * (item.quantity || 1);
  }
  return total > 0 ? total : null;
}

/**
 * Prefill order: the order's own parcel (or a previous shipment attempt), then the product weights from
 * Shopify, then the workspace defaults from Settings.
 */
export function bookingDefaults(order: OrderDetail, settings: IndiaPostSettings): ParcelForm {
  const services = bookableServices(settings);
  const preferred = [order.shipment?.service_code, order.indiaPostService, settings.defaultServiceCode];
  const serviceCode =
    preferred.find((code) => code && services.some((option) => option.code === code)) ?? services[0]?.code ?? "";
  const shipment = order.shipment;
  const weight =
    order.parcelWeightGrams ?? shipment?.weight_grams ?? lineItemsWeight(order) ?? settings.defaultWeightGrams ?? null;
  const asText = (value: number | null | undefined) => (value == null ? "" : String(value));
  return {
    serviceCode,
    weightGrams: asText(weight),
    lengthCm: asText(shipment?.length_cm ?? settings.defaultLengthCm),
    widthCm: asText(shipment?.width_cm ?? settings.defaultWidthCm),
    heightCm: asText(shipment?.height_cm ?? settings.defaultHeightCm),
  };
}

/** Parsed parcel ready to send, or the first problem to show next to the form. */
export function parcelPayload(form: ParcelForm):
  | { ok: true; value: { serviceCode: string; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number } }
  | { ok: false; error: string } {
  if (!form.serviceCode) return { ok: false, error: "Choose an India Post service." };
  const weightGrams = positiveNumber(form.weightGrams);
  if (!weightGrams) return { ok: false, error: "Enter the parcel weight in grams." };
  const lengthCm = positiveNumber(form.lengthCm);
  const widthCm = positiveNumber(form.widthCm);
  const heightCm = positiveNumber(form.heightCm);
  if (!lengthCm || !widthCm || !heightCm) return { ok: false, error: "Enter the parcel length, width and height in cm." };
  if (lengthCm > 150 || widthCm > 150 || heightCm > 150) {
    return { ok: false, error: "India Post accepts parcels up to 150 cm on each side." };
  }
  return { ok: true, value: { serviceCode: form.serviceCode, weightGrams: Math.round(weightGrams), lengthCm, widthCm, heightCm } };
}

/** Why this order can't be booked right now (null when it can). */
export function bookingBlocker(order: OrderDetail, settings: IndiaPostSettings) {
  if (String(settings.status).toUpperCase() !== "CONNECTED") {
    return { message: "Connect your India Post account before booking.", href: "/shopify/settings" };
  }
  if (bookableServices(settings).length === 0) {
    return { message: "Add an India Post contract ID in Settings before booking.", href: "/shopify/settings#contract" };
  }
  const status = String(order.status).toUpperCase();
  if (status === "CANCELLED") return { message: "This order was cancelled in Shopify.", href: null };
  if (isShipmentActive(order.shipment?.status)) return { message: "This order already has an India Post shipment.", href: null };
  const pincode = order.shipping_address?.pincode ?? "";
  if (!/^\d{6}$/.test(pincode)) {
    return { message: "The shipping address needs a valid 6-digit PIN code.", href: null };
  }
  return null;
}
