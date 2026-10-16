import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { env } from "@/lib/env";
import { logInfo } from "@/lib/logger";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeTariff, loadTariffConnection, loadTariffOrder, resolveTariffInput, safeTariffError, saveTariffEstimate, tariffError, tariffOrderDefaults, tariffSenderChoices, type TariffConnection } from "@/modules/india-post/tariff";

const inFlight = new Map<string, number>();
function privateResponse(value: unknown) {
  const response = ok(value);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function handleTariffRoutes(request: NextRequest, supabase: SupabaseClient, ctx: TenantContext, path: string) {
  const capabilities = request.method === "GET" && path === "india-post/tariff-capabilities";
  const manual = request.method === "POST" && path === "india-post/tariff-quotes";
  const orderMatch = request.method === "POST" ? /^orders\/([^/]+)\/tariff-quote$/.exec(path) : null;
  if (!capabilities && !manual && !orderMatch) return null;
  const permission = manual ? "orders.write" : "orders.read";
  if (!ctx.permissions.includes(permission)) throw tariffError("UNAUTHORIZED", "You do not have permission to calculate estimates.", ERROR_CODES.FORBIDDEN);
  if (!env.indiaPostTariffQuotesEnabled) {
    if (capabilities) return privateResponse({ enabled: false, organizationId: ctx.organizationId, senderChoices: [] });
    throw tariffError("FEATURE_DISABLED", "Shipping estimates are not enabled.", ERROR_CODES.FORBIDDEN);
  }
  if (capabilities) {
    const { data, error } = await supabase.from("india_post_connections").select("pickup_office_pincode,pickup_dropoff_office_pincode,default_length_cm,default_width_cm,default_height_cm,default_weight_grams").eq("organization_id", ctx.organizationId).maybeSingle();
    if (error) throw tariffError("INTERNAL_ERROR", "Unable to load estimate settings.");
    const orderId = request.nextUrl.searchParams.get("orderId");
    const order = orderId ? await loadTariffOrder(supabase, ctx.organizationId, orderId) : undefined;
    const connection = (data ?? {}) as TariffConnection;
    return privateResponse({
      enabled: true,
      organizationId: ctx.organizationId,
      senderChoices: tariffSenderChoices(connection),
      defaults: order
        ? tariffOrderDefaults(order, connection)
        : {
            weightGrams: connection.default_weight_grams ?? undefined,
            lengthCm: connection.default_length_cm ?? undefined,
            widthCm: connection.default_width_cm ?? undefined,
            heightCm: connection.default_height_cm ?? undefined,
          },
    });
  }
  if (!rateLimit(`tariff:${ctx.organizationId}`, 90, 60_000).ok || (inFlight.get(ctx.organizationId) ?? 0) >= 2) throw tariffError("RATE_LIMITED", "Please wait before requesting another estimate.", ERROR_CODES.RATE_LIMITED);
  inFlight.set(ctx.organizationId, (inFlight.get(ctx.organizationId) ?? 0) + 1);
  const started = Date.now();
  const orderId = orderMatch?.[1];
  let service: string | undefined;
  try {
    const body: unknown = await request.json().catch(() => null);
    // Ownership is verified with the request client before privileged credential access.
    const order = orderId ? await loadTariffOrder(supabase, ctx.organizationId, orderId) : undefined;
    const admin = createAdminClient();
    const connection = await loadTariffConnection(admin, ctx.organizationId);
    const input = resolveTariffInput(body, connection, order);
    service = input.service;
    const quote = await executeTariff(admin, ctx.organizationId, connection, input);
    if (orderId) await saveTariffEstimate(admin, ctx.organizationId, orderId, input, quote);
    logInfo("india-post.tariff", { organizationId: ctx.organizationId, orderId, service, category: "SUCCESS", durationMs: Date.now() - started });
    return privateResponse(quote);
  } catch (error) {
    const safe = safeTariffError(error);
    logInfo("india-post.tariff", { organizationId: ctx.organizationId, orderId, service, category: safe.details, status: safe.status, durationMs: Date.now() - started });
    throw safe;
  } finally {
    const remaining = (inFlight.get(ctx.organizationId) ?? 1) - 1;
    if (remaining > 0) inFlight.set(ctx.organizationId, remaining);
    else inFlight.delete(ctx.organizationId);
  }
}
