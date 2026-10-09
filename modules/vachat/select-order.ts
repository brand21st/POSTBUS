import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/api/errors";
import {
  listEligibleOrders,
  parseEligibleChoiceRef,
} from "@/modules/vachat/eligible-orders";
import {
  bindSupportSessionOrder,
  findSupportSessionById,
  isSupportSessionExpired,
  sessionPhoneDigits,
  type WhatsappSupportSession,
} from "@/modules/vachat/support-session";

export const SELECT_SUPPORT_REJECTED = "REJECTED";
export const SELECT_SUPPORT_EXPIRED = "SESSION_EXPIRED";

export type SelectSupportOrderInput = {
  sessionId: string;
  choiceRef: string;
  now?: Date;
  order_id?: string | null;
  organization_id?: string | null;
  merchant_id?: string | null;
  customer_id?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
};

export type SelectSupportOrderResult =
  | {
      ok: true;
      alreadyBound: boolean;
      session: WhatsappSupportSession;
      order_id: string;
      organization_id: string;
    }
  | {
      ok: false;
      code: typeof SELECT_SUPPORT_REJECTED | typeof SELECT_SUPPORT_EXPIRED;
      message: string;
    };

const SAFE_REJECT: Extract<SelectSupportOrderResult, { ok: false }> = {
  ok: false,
  code: SELECT_SUPPORT_REJECTED,
  message: "That order is not available for WhatsApp support.",
};

const SAFE_EXPIRED: Extract<SelectSupportOrderResult, { ok: false }> = {
  ok: false,
  code: SELECT_SUPPORT_EXPIRED,
  message: "This support session has expired. Please start again.",
};

function isBusinessLineError(error: unknown) {
  return error instanceof AppError && /PostBus WhatsApp line/i.test(error.message);
}

export async function selectSupportOrder(
  supabase: SupabaseClient,
  input: SelectSupportOrderInput
): Promise<SelectSupportOrderResult> {
  const now = input.now ?? new Date();
  const session = await findSupportSessionById(supabase, input.sessionId);
  if (!session || session.source !== "platform" || !session.phone_digits) {
    return SAFE_REJECT;
  }
  if (isSupportSessionExpired(session, now)) {
    return SAFE_EXPIRED;
  }

  try {
    sessionPhoneDigits(session.phone_digits);
  } catch (error) {
    if (isBusinessLineError(error)) return SAFE_REJECT;
    return SAFE_REJECT;
  }

  const parsed = parseEligibleChoiceRef(String(input.choiceRef ?? "").trim());
  if (!parsed) return SAFE_REJECT;
  if (parsed.phone_digits !== session.phone_digits) return SAFE_REJECT;

  let listed;
  try {
    listed = await listEligibleOrders(supabase, {
      session: {
        ...session,
        selected_organization_id: session.selected_organization_id || parsed.organization_id,
      },
      now,
    });
  } catch (error) {
    if (isBusinessLineError(error)) return SAFE_REJECT;
    throw error;
  }

  const match = listed.choices.find((choice) => {
    const decoded = parseEligibleChoiceRef(choice.ref);
    return (
      decoded?.order_id === parsed.order_id &&
      decoded?.organization_id === parsed.organization_id &&
      decoded?.phone_digits === session.phone_digits
    );
  });
  if (!match) return SAFE_REJECT;

  if (session.state === "ORDER_BOUND") {
    if (
      session.selected_order_id === parsed.order_id &&
      session.selected_organization_id === parsed.organization_id
    ) {
      return {
        ok: true,
        alreadyBound: true,
        session,
        order_id: parsed.order_id,
        organization_id: parsed.organization_id,
      };
    }
    return SAFE_REJECT;
  }

  const bound = await bindSupportSessionOrder(
    supabase,
    session.id,
    { orderId: parsed.order_id, organizationId: parsed.organization_id },
    now
  );
  return {
    ok: true,
    alreadyBound: false,
    session: bound,
    order_id: parsed.order_id,
    organization_id: parsed.organization_id,
  };
}
