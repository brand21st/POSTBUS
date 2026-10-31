import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { parseExtraCodCharge, tryParseExtraCodCharge } from "@/modules/orders/extra-cod";

export const MANUAL_ORDER_PAYMENT_DEFAULTS = ["PAID", "PARTIAL", "COD"] as const;
export type ManualOrderPaymentDefault = (typeof MANUAL_ORDER_PAYMENT_DEFAULTS)[number];

export const saveOrderPaymentDefaultSchema = z
  .object({
    paymentStatus: z.enum(MANUAL_ORDER_PAYMENT_DEFAULTS).optional(),
    extraCodCharge: z.unknown().optional(),
  })
  .refine((value) => value.paymentStatus !== undefined || value.extraCodCharge !== undefined, {
    message: "Choose a payment status or an extra COD charge.",
  });

export type OrderPaymentDefault = {
  paymentStatus: ManualOrderPaymentDefault | null;
  extraCodCharge: number | null;
};

type OrderDefaultRow = {
  payment_status?: string | null;
  extra_cod_charge?: number | string | null;
};

function isManualPaymentDefault(value: unknown): value is ManualOrderPaymentDefault {
  return MANUAL_ORDER_PAYMENT_DEFAULTS.includes(value as ManualOrderPaymentDefault);
}

function storedExtraCodCharge(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = tryParseExtraCodCharge(value);
  return parsed.ok ? parsed.amount : null;
}

function toOrderDefault(row: OrderDefaultRow | null): OrderPaymentDefault {
  return {
    paymentStatus: isManualPaymentDefault(row?.payment_status) ? row.payment_status : null,
    extraCodCharge: storedExtraCodCharge(row?.extra_cod_charge),
  };
}

export async function getOrderPaymentDefault(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<OrderPaymentDefault> {
  const { data, error } = await supabase
    .from("user_order_defaults")
    .select("payment_status, extra_cod_charge")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load the payment default.");
  }

  return toOrderDefault(data);
}

export async function saveOrderPaymentDefault(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  input: z.infer<typeof saveOrderPaymentDefaultSchema>
): Promise<OrderPaymentDefault> {
  const extraCodCharge =
    input.extraCodCharge === undefined ? undefined : parseExtraCodCharge(input.extraCodCharge);
  const payload: {
    user_id: string;
    organization_id: string;
    payment_status?: ManualOrderPaymentDefault;
    extra_cod_charge?: number;
  } = {
    user_id: userId,
    organization_id: organizationId,
  };
  if (input.paymentStatus) payload.payment_status = input.paymentStatus;
  if (extraCodCharge !== undefined) payload.extra_cod_charge = extraCodCharge;

  const { data, error } = await supabase
    .from("user_order_defaults")
    .upsert(payload, { onConflict: "user_id,organization_id" })
    .select("payment_status, extra_cod_charge")
    .single();

  if (error || !data) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not save the order default.");
  }
  if (input.paymentStatus && !isManualPaymentDefault(data.payment_status)) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not save the payment default.");
  }
  if (extraCodCharge !== undefined && storedExtraCodCharge(data.extra_cod_charge) !== extraCodCharge) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not save the extra COD charge default.");
  }

  return toOrderDefault(data);
}
