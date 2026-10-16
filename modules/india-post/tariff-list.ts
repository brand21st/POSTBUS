import { tariffEstimateKey, tariffInputSchema, type TariffInput } from "@/modules/india-post/tariff-contract";
import type { OrderRecord } from "@/types/api";

export type TariffListDefaults = {
  service?: string | null;
  sourcePincode?: string | null;
  destinationPincode?: string | null;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

export type TariffListState =
  | { status: "missing"; warning: string }
  | { status: "blocked"; warning: string }
  | { status: "saved"; input: TariffInput; key: string }
  | { status: "quote"; input: TariffInput; key: string };

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function orderLineWeight(order: OrderRecord) {
  const lines = order.lineItems ?? order.line_items ?? [];
  if (!lines.length) return undefined;
  if (!lines.every((line) => positive(line.weightGrams ?? line.weight_grams) && positive(line.quantity))) return undefined;
  return lines.reduce(
    (sum, line) => sum + Number(line.weightGrams ?? line.weight_grams) * Number(line.quantity),
    0
  );
}

function normalizedService(value: unknown) {
  const service = String(value ?? "").trim().toUpperCase();
  if (service === "BP") return "BUSINESS_PARCEL";
  if (service === "SP") return "SP_INLAND_PARCEL";
  return service || undefined;
}

export function tariffListState(order: OrderRecord, defaults: TariffListDefaults): TariffListState {
  const shipment = order.shipment;
  const manualWeight = (order.parcelWeightMode ?? order.parcel_weight_mode) === "manual"
    ? positive(order.parcelWeightGrams ?? order.parcel_weight_grams)
    : undefined;
  const input = {
    service: normalizedService(order.indiaPostService ?? order.india_post_service ?? shipment?.serviceCode ?? shipment?.service_code ?? defaults.service),
    sourcePincode: defaults.sourcePincode,
    destinationPincode: order.shippingAddress?.pincode ?? defaults.destinationPincode,
    weightGrams: manualWeight ?? orderLineWeight(order) ?? positive(shipment?.weightGrams ?? shipment?.weight_grams) ?? positive(defaults.weightGrams),
    lengthCm: positive(shipment?.lengthCm ?? shipment?.length_cm) ?? positive(defaults.lengthCm),
    widthCm: positive(shipment?.widthCm ?? shipment?.width_cm) ?? positive(defaults.widthCm),
    heightCm: positive(shipment?.heightCm ?? shipment?.height_cm) ?? positive(defaults.heightCm),
  };
  if (!input.weightGrams || !input.lengthCm || !input.widthCm || !input.heightCm) {
    return { status: "missing", warning: "Add weight & size" };
  }
  if (input.service === "SP_INLAND_PARCEL" && input.weightGrams <= 500) {
    return { status: "blocked", warning: "Tariff needs review" };
  }
  const parsed = tariffInputSchema.safeParse(input);
  if (!parsed.success) return { status: "blocked", warning: "Check parcel setup" };
  const key = tariffEstimateKey(parsed.data);
  const savedKey = order.indiaPostEstimateKey ?? order.india_post_estimate_key;
  const amount = order.indiaPostEstimateAmount ?? order.india_post_estimate_amount;
  return savedKey === key && amount != null
    ? { status: "saved", input: parsed.data, key }
    : { status: "quote", input: parsed.data, key };
}
