import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/security/crypto";
import { persistIndiaPostTokens, withProcessSessionLock } from "@/modules/india-post/session";
import { IndiaPostProvider } from "@/modules/india-post/provider";
import { withIndiaPostSessionLock } from "@/modules/india-post/session-lock";
import { orderLookup } from "@/modules/orders/order-number";
import { manualTariffSchema, orderTariffSchema, tariffEstimateKey, tariffInputSchema, normalizeTariff, type TariffInput, type TariffQuote } from "@/modules/india-post/tariff-contract";

export function tariffError(category: string, message: string, code: ConstructorParameters<typeof AppError>[0] = ERROR_CODES.PROVIDER_ERROR) {
  return new AppError(code, message, { category });
}
export function safeTariffError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return tariffError("INDIA_POST_TIMEOUT", "Shipping estimate timed out. Please try again.");
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return tariffError("INDIA_POST_AUTH_FAILED", "India Post authentication failed. Check your connection settings.");
  if (status === 429) return tariffError("RATE_LIMITED", "India Post is busy. Please try again later.", ERROR_CODES.RATE_LIMITED);
  return tariffError("INDIA_POST_UNAVAILABLE", "Shipping estimate is temporarily unavailable. Please try again.");
}

export type TariffConnection = ConstructorParameters<typeof IndiaPostProvider>[0] & {
  id: string; organization_id: string;
  pickup_office_pincode?: string | null; pickup_dropoff_office_pincode?: string | null;
  default_length_cm?: number | null; default_width_cm?: number | null; default_height_cm?: number | null; default_weight_grams?: number | null;
};
const CONNECTION_COLUMNS = "id,organization_id,environment,status,encrypted_username,encrypted_password,encrypted_access_token,encrypted_refresh_token,encrypted_id_token,expires_at,refresh_expires_at,pickup_office_pincode,pickup_dropoff_office_pincode,default_length_cm,default_width_cm,default_height_cm,default_weight_grams";
export async function loadTariffConnection(db: SupabaseClient, organizationId: string): Promise<TariffConnection> {
  const { data, error } = await db.from("india_post_connections").select(CONNECTION_COLUMNS).eq("organization_id", organizationId).maybeSingle();
  if (error) throw tariffError("INTERNAL_ERROR", "Unable to load India Post settings.");
  if (!data || data.status !== "CONNECTED") throw tariffError("INDIA_POST_NOT_CONNECTED", "Please configure your India Post account.", ERROR_CODES.INTEGRATION_NOT_CONNECTED);
  return data as TariffConnection;
}
export function tariffSenderChoices(connection: Pick<TariffConnection, "pickup_office_pincode" | "pickup_dropoff_office_pincode">) {
  const choices: Array<{ id: "pickup" | "dropoff"; pincode: string; label: string }> = [];
  if (/^\d{6}$/.test(connection.pickup_office_pincode ?? "")) choices.push({ id: "pickup", pincode: connection.pickup_office_pincode!, label: "Configured pickup office" });
  if (/^\d{6}$/.test(connection.pickup_dropoff_office_pincode ?? "") && !choices.some((choice) => choice.pincode === connection.pickup_dropoff_office_pincode)) choices.push({ id: "dropoff", pincode: connection.pickup_dropoff_office_pincode!, label: "Configured drop-off office" });
  return choices;
}
export function tariffSourcePincode(connection: TariffConnection, office?: "pickup" | "dropoff") {
  const choices = tariffSenderChoices(connection);
  // Both configured office IDs remain valid when they share a pincode.
  const selected = office === "pickup" ? connection.pickup_office_pincode : office === "dropoff" ? connection.pickup_dropoff_office_pincode : choices.length === 1 ? choices[0].pincode : null;
  if (!selected || !/^\d{6}$/.test(selected)) throw tariffError("MISSING_SENDER_PINCODE", choices.length > 1 ? "Choose a configured sender office." : "Please configure a valid India Post sender pincode.", ERROR_CODES.VALIDATION_ERROR);
  return selected;
}

export type TariffOrder = {
  id?: string;
  india_post_service?: string | null; parcel_weight_mode?: string | null; parcel_weight_grams?: number | null;
  shipping_address: { pincode?: string | null } | null;
  order_line_items: Array<{ weight_grams: number | null; quantity: number }>;
  shipments: Array<{ weight_grams?: number | null; length_cm?: number | null; width_cm?: number | null; height_cm?: number | null; service_code?: string | null; created_at?: string }>;
};
export async function loadTariffOrder(db: SupabaseClient, organizationId: string, id: string): Promise<TariffOrder> {
  const lookup = orderLookup(id);
  if (!lookup) throw tariffError("ORDER_NOT_FOUND", "Order not found.", ERROR_CODES.RESOURCE_NOT_FOUND);
  const { data, error } = await db.from("orders").select("id,india_post_service,parcel_weight_mode,parcel_weight_grams,shipping_address:addresses!shipping_address_id(pincode),order_line_items(weight_grams,quantity),shipments(weight_grams,length_cm,width_cm,height_cm,service_code,created_at)").eq("organization_id", organizationId).eq(lookup.column, lookup.value).maybeSingle();
  if (error) throw tariffError("INTERNAL_ERROR", "Unable to load order details.");
  if (!data) throw tariffError("ORDER_NOT_FOUND", "Order not found.", ERROR_CODES.RESOURCE_NOT_FOUND);
  return data as unknown as TariffOrder;
}
export function tariffOrderDefaults(order: TariffOrder, connection: TariffConnection) {
  const shipment = [...(order.shipments ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const lines = order.order_line_items ?? [];
  const lineWeight = lines.length && lines.every((line) => Number(line.weight_grams) > 0 && Number(line.quantity) > 0) ? lines.reduce((sum, line) => sum + Number(line.weight_grams) * line.quantity, 0) : undefined;
  const rawService = order.india_post_service ?? shipment?.service_code;
  return {
    service: rawService === "BP" ? "BUSINESS_PARCEL" : rawService === "SP" ? "SP_INLAND_PARCEL" : rawService,
    destinationPincode: order.shipping_address?.pincode,
    weightGrams: (order.parcel_weight_mode === "manual" ? order.parcel_weight_grams : lineWeight) ?? shipment?.weight_grams ?? connection.default_weight_grams ?? undefined,
    lengthCm: shipment?.length_cm ?? connection.default_length_cm ?? undefined,
    widthCm: shipment?.width_cm ?? connection.default_width_cm ?? undefined,
    heightCm: shipment?.height_cm ?? connection.default_height_cm ?? undefined,
  };
}
export function resolveTariffInput(body: unknown, connection: TariffConnection, order?: TariffOrder): TariffInput {
  const parsed = (order ? orderTariffSchema : manualTariffSchema).safeParse(body);
  const categories: Record<string, string> = { service: "INVALID_SERVICE", weightGrams: "INVALID_WEIGHT", lengthCm: "INVALID_DIMENSIONS", widthCm: "INVALID_DIMENSIONS", heightCm: "INVALID_DIMENSIONS", destinationPincode: "INVALID_PINCODE", codAmount: "VALIDATION_ERROR" };
  if (!parsed.success) throw tariffError(categories[String(parsed.error.issues[0]?.path[0])] ?? "VALIDATION_ERROR", "Check the quote fields; only supported tariff inputs are accepted.", ERROR_CODES.VALIDATION_ERROR);
  const input = tariffInputSchema.safeParse({ ...(order ? tariffOrderDefaults(order, connection) : {}), ...parsed.data, sourcePincode: tariffSourcePincode(connection, parsed.data.senderOffice) });
  if (!input.success) throw tariffError(categories[String(input.error.issues[0]?.path[0])] ?? "VALIDATION_ERROR", input.error.issues[0]?.message ?? "Enter valid parcel details.", ERROR_CODES.VALIDATION_ERROR);
  return input.data;
}

// Only the trusted tenant route supplies this server-side client and organization.
// Do not use the booking session helper: quotes must never acquire its booking lock.
export async function tariffSession(db: SupabaseClient, organizationId: string, connectionId: string, rejectedToken?: string) {
  return withProcessSessionLock(connectionId, () =>
    withIndiaPostSessionLock(db, { connectionId, organizationId }, async (lockToken) => {
    const connection = await loadTariffConnection(db, organizationId);
    if (connection.id !== connectionId) throw tariffError("INDIA_POST_AUTH_FAILED", "India Post connection changed. Please retry.");
    if (rejectedToken && connection.encrypted_access_token && decryptSecret(connection.encrypted_access_token) === rejectedToken) {
      connection.encrypted_access_token = null;
      connection.expires_at = null;
    }
    const provider = new IndiaPostProvider(connection);
    let session: Awaited<ReturnType<IndiaPostProvider["ensureSession"]>>;
    try { session = await provider.ensureSession(); }
    catch { throw tariffError("INDIA_POST_AUTH_FAILED", "India Post authentication failed. Check your connection settings."); }
    if (!session.access_token || (session.tokens && (!Number.isFinite(session.tokens.expires_in) || session.tokens.expires_in <= 60))) throw tariffError("INDIA_POST_AUTH_FAILED", "India Post returned an invalid authentication session.");
    if (session.tokens) {
      try {
        await persistIndiaPostTokens(
          db,
          { id: connectionId, organization_id: organizationId, sessionLockToken: lockToken },
          session.tokens
        );
      } catch {
        throw tariffError("INTERNAL_ERROR", "Unable to save the India Post session. Please retry.");
      }
    }
    return { provider, accessToken: session.access_token };
    })
  );
}
async function readTariff(session: { provider: { getTariff(input: TariffInput): Promise<unknown> }; accessToken: string }, db: SupabaseClient, organizationId: string, connectionId: string, input: TariffInput) {
  try { return { session, raw: await session.provider.getTariff(input) }; }
  catch (error) {
    if ((error as { status?: number })?.status !== 401) throw error;
    const refreshed = await tariffSession(db, organizationId, connectionId, session.accessToken);
    return { session: refreshed, raw: await refreshed.provider.getTariff(input) };
  }
}

export async function executeTariff(db: SupabaseClient, organizationId: string, connection: TariffConnection, input: TariffInput) {
  try {
    const session = await tariffSession(db, organizationId, connection.id);
    let raw: unknown;
    try {
      raw = (await readTariff(session, db, organizationId, connection.id, input)).raw;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status !== 400 || !(input.codAmount != null && input.codAmount > 0)) throw error;
      const withoutCod = { ...input, codAmount: undefined };
      raw = (await readTariff(session, db, organizationId, connection.id, withoutCod)).raw;
    }
    try { return normalizeTariff(raw, input); }
    catch { throw tariffError("INDIA_POST_INVALID_RESPONSE", "India Post returned an invalid estimate. Please try again."); }
  } catch (error) {
    if (error instanceof SyntaxError) throw tariffError("INDIA_POST_INVALID_RESPONSE", "India Post returned an invalid estimate. Please try again.");
    throw safeTariffError(error);
  }
}

export async function saveTariffEstimate(
  db: SupabaseClient,
  organizationId: string,
  orderId: string,
  input: TariffInput,
  quote: Pick<TariffQuote, "estimatedTotal" | "calculatedAt">
) {
  const lookup = orderLookup(orderId);
  if (lookup?.column !== "id") throw tariffError("INTERNAL_ERROR", "Unable to save the shipping estimate.");
  const { data, error } = await db
    .from("orders")
    .update({
      india_post_estimate_amount: quote.estimatedTotal,
      india_post_estimated_at: quote.calculatedAt,
      india_post_estimate_key: tariffEstimateKey(input),
    })
    .eq("organization_id", organizationId)
    .eq("id", lookup.value)
    .select("id")
    .maybeSingle();
  if (error || !data) throw tariffError("INTERNAL_ERROR", "Unable to save the shipping estimate.");
}
