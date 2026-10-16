import { z } from "zod";

export const tariffServiceSchema = z.enum(["SP_INLAND_DOC", "SP_INLAND_PARCEL", "BUSINESS_PARCEL"]);
const positive = z.number().finite().positive();
const money = z.number().finite().nonnegative();
export const tariffFields = {
  service: tariffServiceSchema,
  senderOffice: z.enum(["pickup", "dropoff"]).optional(),
  weightGrams: positive.int(),
  lengthCm: positive,
  widthCm: positive,
  heightCm: positive,
  insuranceValue: money.optional(),
  proofOfDelivery: z.boolean().optional(),
};
export const manualTariffSchema = z.object({ ...tariffFields, destinationPincode: z.string().regex(/^\d{6}$/) }).strict();
export const orderTariffSchema = z.object(tariffFields).partial().strict();
export function usableTariffDraft<T extends Record<string, unknown>>(draft?: T): Partial<T> {
  if (!draft) return {};
  return Object.fromEntries(
    Object.entries(draft).filter(([, value]) =>
      typeof value === "number"
        ? Number.isFinite(value) && value > 0
        : typeof value === "string"
          ? value.trim().length > 0
          : value != null
    )
  ) as Partial<T>;
}
export const tariffInputSchema = manualTariffSchema.extend({ sourcePincode: z.string().regex(/^\d{6}$/) }).superRefine((input, ctx) => {
  const doc = input.service === "SP_INLAND_DOC";
  if (input.weightGrams > (doc ? 500 : 35000)) ctx.addIssue({ code: "custom", path: ["weightGrams"], message: "Weight exceeds the service limit." });
  if (input.service === "SP_INLAND_PARCEL" && input.weightGrams <= 500) ctx.addIssue({ code: "custom", path: ["weightGrams"], message: "Speed Post parcel estimates at 500 g or less require provider verification. Booking remains available." });
  const bounds = doc ? [[1, 42], [1, 29], [1, 2]] : [[14, 150], [9, 150], [1, 150]];
  (["lengthCm", "widthCm", "heightCm"] as const).forEach((key, index) => {
    if (input[key] < bounds[index][0] || input[key] > bounds[index][1]) ctx.addIssue({ code: "custom", path: [key], message: `${key} must be between ${bounds[index][0]} and ${bounds[index][1]} cm.` });
  });
  if (input.service === "BUSINESS_PARCEL" && input.proofOfDelivery) ctx.addIssue({ code: "custom", path: ["proofOfDelivery"], message: "Proof of delivery is not supported for Business Parcel estimates." });
});
export type TariffInput = z.infer<typeof tariffInputSchema>;
export type TariffDraft = z.infer<typeof orderTariffSchema>;

export function tariffEstimateKey(input: TariffInput) {
  const value = tariffInputSchema.parse(input);
  return [
    "v1",
    value.service,
    value.sourcePincode,
    value.destinationPincode,
    value.weightGrams,
    value.lengthCm,
    value.widthCm,
    value.heightCm,
    value.insuranceValue ?? "",
    value.proofOfDelivery ? "POD" : "",
  ].join("|");
}

const nullableMoney = money.nullish().transform((value) => value ?? null);
export const tariffResponseSchema = z.object({
  success: z.literal(true), currency: z.literal("INR"),
  base_tariff: money, final_amount: money,
  article_type: z.string().nullish(),
  chargeable_weight: positive.nullish(),
  vas_charges: z.union([money, z.record(z.string(), money)]).nullish(),
  cod_charges: nullableMoney, cgst: nullableMoney, sgst: nullableMoney, total_tax: nullableMoney,
});

export function tariffRequest(input: TariffInput) {
  const data = tariffInputSchema.parse(input);
  const bp = data.service === "BUSINESS_PARCEL";
  const query = new URLSearchParams({ "product-code": bp ? "BP" : "SP", weight: String(data.weightGrams), "source-pincode": data.sourcePincode, "destination-pincode": data.destinationPincode, length: String(data.lengthCm), width: String(data.widthCm), height: String(data.heightCm) });
  if (data.insuranceValue != null) query.set(bp ? "ins" : "INS", String(data.insuranceValue));
  if (!bp && data.proofOfDelivery) query.set("POD", "YES");
  return `${bp ? "/business-parcel-tariff/calculate" : "/speed-post/tariffs"}?${query}`;
}

export function normalizeTariff(raw: unknown, input: TariffInput) {
  const value = tariffResponseSchema.parse(raw);
  return {
    provider: "INDIA_POST" as const, service: input.service, articleType: value.article_type ?? null,
    sourcePincode: input.sourcePincode, destinationPincode: input.destinationPincode,
    physicalWeightGrams: input.weightGrams, chargeableWeightGrams: value.chargeable_weight ?? null,
    baseTariff: value.base_tariff, vasCharges: value.vas_charges ?? null, codCharges: value.cod_charges,
    cgst: value.cgst, sgst: value.sgst, totalTax: value.total_tax,
    estimatedTotal: value.final_amount, currency: value.currency, calculatedAt: new Date().toISOString(), isEstimate: true as const,
  };
}
export type TariffQuote = ReturnType<typeof normalizeTariff>;
