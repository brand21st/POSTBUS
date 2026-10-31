import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export const MANUAL_ORDER_PAYMENT_DEFAULTS = ["PAID", "PARTIAL", "COD"] as const;
export type ManualOrderPaymentDefault = (typeof MANUAL_ORDER_PAYMENT_DEFAULTS)[number];

export const saveOrderPaymentDefaultSchema = z.object({
  paymentStatus: z.enum(MANUAL_ORDER_PAYMENT_DEFAULTS),
});

export type OrderPaymentDefault = {
  paymentStatus: ManualOrderPaymentDefault | null;
};

function isManualPaymentDefault(value: unknown): value is ManualOrderPaymentDefault {
  return MANUAL_ORDER_PAYMENT_DEFAULTS.includes(value as ManualOrderPaymentDefault);
}

export async function getOrderPaymentDefault(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<OrderPaymentDefault> {
  const { data, error } = await supabase
    .from("user_order_defaults")
    .select("payment_status")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load the payment default.");
  }

  return {
    paymentStatus: isManualPaymentDefault(data?.payment_status) ? data.payment_status : null,
  };
}

export async function saveOrderPaymentDefault(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  input: z.infer<typeof saveOrderPaymentDefaultSchema>
): Promise<OrderPaymentDefault> {
  const { data, error } = await supabase
    .from("user_order_defaults")
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        payment_status: input.paymentStatus,
      },
      { onConflict: "user_id,organization_id" }
    )
    .select("payment_status")
    .single();

  if (error || !isManualPaymentDefault(data?.payment_status)) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not save the payment default.");
  }

  return { paymentStatus: data.payment_status };
}
