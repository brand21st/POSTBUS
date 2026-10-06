import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { hmacSha256, safeEqual } from "@/lib/security/crypto";
import {
  findOrganizationsForCustomerPhone,
  orderIdsForCustomerPhone,
} from "@/modules/vachat/knowledge";
import {
  currentShipmentDeliveredAt,
  isWhatsAppSupportEligible,
} from "@/modules/vachat/support-eligibility";
import {
  sessionPhoneDigits,
  type WhatsappSupportSession,
} from "@/modules/vachat/support-session";

export const ELIGIBLE_ORDER_LIMIT_PER_ORG = 40;
export const WHATSAPP_SUPPORT_UNAVAILABLE_STATUSES = new Set(["CANCELLED"]);

export type EligibleOrderChoice = {
  ref: string;
  merchant_name: string;
  order_ref: string;
  status: string;
  created_at: string | null;
};

export type EligibleOrderList = {
  choices: EligibleOrderChoice[];
};

export type ListEligibleOrdersInput = {
  session?: WhatsappSupportSession | null;
  phone?: string | null;
  now?: Date;
  merchant_id?: string | null;
  whatsapp?: string | null;
  organization_id?: string | null;
  tenant_id?: string | null;
  customer_id?: string | null;
  order_id?: string | null;
  query?: string | null;
};

export type EligibleChoiceRef = {
  phone_digits: string;
  order_id: string;
  organization_id: string;
};

function toCanonicalPhone(input: ListEligibleOrdersInput): string | null {
  if (input.session?.phone_digits) {
    try {
      return sessionPhoneDigits(input.session.phone_digits);
    } catch (error) {
      if (isBusinessLineError(error)) throw error;
      return null;
    }
  }
  const raw = input.phone;
  if (raw == null || String(raw).trim() === "") return null;
  try {
    return sessionPhoneDigits(raw);
  } catch (error) {
    if (isBusinessLineError(error)) throw error;
    return null;
  }
}

function isBusinessLineError(error: unknown) {
  return error instanceof AppError && /PostBus WhatsApp line/i.test(error.message);
}

export function eligibleChoiceRef(parts: EligibleChoiceRef) {
  const material = `${parts.phone_digits}|${parts.order_id}|${parts.organization_id}`;
  const mac = hmacSha256(material);
  return Buffer.from(`${material}|${mac}`, "utf8").toString("base64url");
}

export function parseEligibleChoiceRef(ref: string): EligibleChoiceRef | null {
  try {
    const decoded = Buffer.from(ref, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 4) return null;
    const [phone_digits, order_id, organization_id, mac] = parts;
    if (!phone_digits || !order_id || !organization_id || !mac) return null;
    const expected = hmacSha256(`${phone_digits}|${order_id}|${organization_id}`);
    if (!safeEqual(mac, expected)) return null;
    return { phone_digits, order_id, organization_id };
  } catch {
    return null;
  }
}

function asList<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function recencyMs(createdAt: string | null) {
  if (!createdAt) return 0;
  const value = Date.parse(createdAt);
  return Number.isFinite(value) ? value : 0;
}

async function loadOrderRows(
  supabase: SupabaseClient,
  organizationId: string,
  orderIds: string[]
) {
  if (!orderIds.length) return [] as Array<Record<string, unknown>>;
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, created_at, organization_id")
    .eq("organization_id", organizationId)
    .in("id", orderIds)
    .limit(ELIGIBLE_ORDER_LIMIT_PER_ORG);
  if (error) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to load eligible orders.");
  }
  return asList(data as Array<Record<string, unknown>> | null);
}

async function loadShipmentEligibilityRows(
  supabase: SupabaseClient,
  organizationId: string,
  orderIds: string[]
) {
  if (!orderIds.length) return [] as Array<Record<string, unknown>>;
  const { data, error } = await supabase
    .from("shipments")
    .select("order_id, organization_id, delivered_at, updated_at")
    .eq("organization_id", organizationId)
    .in("order_id", orderIds);
  if (error) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to load eligible orders.");
  }
  return asList(data as Array<Record<string, unknown>> | null).filter(
    (row) => String(row.organization_id ?? "") === organizationId
  );
}

async function loadMerchantNames(supabase: SupabaseClient, organizationIds: string[]) {
  const names = new Map<string, string>();
  if (!organizationIds.length) return names;
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", organizationIds);
  if (error) {
    throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Unable to load eligible orders.");
  }
  for (const row of asList(data as Array<Record<string, unknown>> | null)) {
    const id = String(row.id ?? "");
    if (!id) continue;
    names.set(id, String(row.name ?? "").trim() || "Merchant");
  }
  return names;
}

export async function listEligibleOrders(
  supabase: SupabaseClient,
  input: ListEligibleOrdersInput
): Promise<EligibleOrderList> {
  const now = input.now ?? new Date();
  const phoneDigits = toCanonicalPhone(input);
  if (!phoneDigits) return { choices: [] };

  const lookupPhone = `+91${phoneDigits}`;
  const organizationIds = await findOrganizationsForCustomerPhone(supabase, lookupPhone);
  if (!organizationIds.length) return { choices: [] };

  const names = await loadMerchantNames(supabase, organizationIds);
  const choices: EligibleOrderChoice[] = [];

  for (const organizationId of organizationIds) {
    const orderIds = await orderIdsForCustomerPhone(supabase, organizationId, lookupPhone);
    const rows = await loadOrderRows(supabase, organizationId, orderIds);
    const shipments = await loadShipmentEligibilityRows(supabase, organizationId, orderIds);
    const merchantName = names.get(organizationId) ?? "Merchant";
    for (const row of rows) {
      const status = String(row.status ?? "");
      if (WHATSAPP_SUPPORT_UNAVAILABLE_STATUSES.has(status)) continue;
      const orderId = String(row.id ?? "");
      const orderRef = String(row.order_number ?? "").trim();
      if (!orderId || !orderRef) continue;
      if (
        !isWhatsAppSupportEligible({
          deliveredAt: currentShipmentDeliveredAt(shipments, orderId),
          now,
        })
      ) {
        continue;
      }
      choices.push({
        ref: eligibleChoiceRef({
          phone_digits: phoneDigits,
          order_id: orderId,
          organization_id: organizationId,
        }),
        merchant_name: merchantName,
        order_ref: orderRef,
        status,
        created_at: row.created_at ? String(row.created_at) : null,
      });
    }
  }

  choices.sort((a, b) => recencyMs(b.created_at) - recencyMs(a.created_at));
  return { choices };
}
