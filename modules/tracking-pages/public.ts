import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import type { PublicTrackResult, PublicTrackingEvent } from "@/types/api";
import { parseTrackingSubdomain } from "./host";
import { getPublishedTrackingPage } from "./service";

type LiveState = PublicTrackResult["liveTracking"];

type CachedLive = {
  expiresAt: number;
  events: PublicTrackingEvent[];
  status?: string | null;
};

const liveCache = new Map<string, CachedLive>();
const LIVE_TTL_MS = 60_000;

type ProviderArticle = {
  booking_details?: { article_number?: string };
  tracking_details?: Array<{
    event?: string;
    office?: string;
    date?: string;
    time?: string;
    event_code?: string;
  }>;
  del_status?: { del_status?: string };
};

function cacheKey(organizationId: string, barcode: string) {
  return `${organizationId}:${barcode}`;
}

function eventOccurredAt(event: { date?: string; time?: string }) {
  if (event.date && event.time) {
    const combined = `${event.date}T${event.time}`;
    const parsed = new Date(combined);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (event.date) {
    const parsed = new Date(event.date);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return event.date;
  }
  return new Date().toISOString();
}

function redactShipment(input: {
  id: string;
  barcode?: string | null;
  trackingNumber?: string | null;
  status?: string | null;
  orderNumber?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  events?: PublicTrackingEvent[] | null;
}): NonNullable<PublicTrackResult["shipment"]> {
  return {
    id: input.id,
    barcode: input.barcode ?? null,
    trackingNumber: input.trackingNumber ?? null,
    status: input.status ?? null,
    orderNumber: input.orderNumber ?? null,
    destinationCity: input.destinationCity ?? null,
    destinationState: input.destinationState ?? null,
    events: (input.events ?? []).map((event) => ({
      id: event.id,
      eventCode: event.eventCode ?? null,
      eventDescription: event.eventDescription ?? null,
      officeName: event.officeName ?? null,
      occurredAt: event.occurredAt ?? null,
    })),
  };
}

async function loadStoredShipment(
  supabase: SupabaseClient,
  organizationId: string,
  query: string
): Promise<NonNullable<PublicTrackResult["shipment"]> | null> {
  if (hasAdminClient()) {
    const admin = createAdminClient();
    const { data: shipment } = await admin
      .from("shipments")
      .select("id, barcode, tracking_number, status, order_id, shipping_address_id")
      .eq("organization_id", organizationId)
      .or(`barcode.eq.${query},tracking_number.eq.${query}`)
      .maybeSingle();
    if (!shipment) return null;

    const [{ data: order }, { data: address }, { data: events }] = await Promise.all([
      shipment.order_id
        ? admin.from("orders").select("order_number").eq("id", shipment.order_id).maybeSingle()
        : Promise.resolve({ data: null }),
      shipment.shipping_address_id
        ? admin.from("addresses").select("city, state").eq("id", shipment.shipping_address_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("tracking_events")
        .select("id, event_code, event_description, office_name, occurred_at")
        .eq("shipment_id", shipment.id)
        .order("occurred_at", { ascending: false }),
    ]);

    return redactShipment({
      id: shipment.id,
      barcode: shipment.barcode,
      trackingNumber: shipment.tracking_number,
      status: shipment.status,
      orderNumber: order?.order_number ?? null,
      destinationCity: address?.city ?? null,
      destinationState: address?.state ?? null,
      events: (events ?? []).map((event) => ({
        id: event.id,
        eventCode: event.event_code,
        eventDescription: event.event_description,
        officeName: event.office_name,
        occurredAt: event.occurred_at,
      })),
    });
  }

  const { data, error } = await supabase.rpc("public_find_shipment", {
    p_organization_id: organizationId,
    p_query: query,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) return null;
  const row = data as {
    id: string;
    barcode?: string | null;
    trackingNumber?: string | null;
    status?: string | null;
    orderNumber?: string | null;
    destinationCity?: string | null;
    destinationState?: string | null;
    events?: PublicTrackingEvent[];
  };
  return redactShipment(row);
}

async function persistEvents(
  organizationId: string,
  shipmentId: string,
  events: Array<{
    eventCode: string;
    eventDescription: string | null;
    officeName: string | null;
    occurredAt: string;
    raw: unknown;
  }>,
  supabase: SupabaseClient
) {
  if (hasAdminClient()) {
    const admin = createAdminClient();
    for (const event of events) {
      const { error } = await admin.from("tracking_events").insert({
        organization_id: organizationId,
        shipment_id: shipmentId,
        event_code: event.eventCode,
        event_description: event.eventDescription,
        office_name: event.officeName,
        occurred_at: event.occurredAt,
        raw: event.raw ?? {},
      });
      if (error && error.code !== "23505") {
        throw new AppError(ERROR_CODES.PROVIDER_ERROR, error.message);
      }
    }
    return;
  }

  for (const event of events) {
    const { error } = await supabase.rpc("public_insert_tracking_event", {
      p_organization_id: organizationId,
      p_shipment_id: shipmentId,
      p_event_code: event.eventCode,
      p_event_description: event.eventDescription,
      p_office_name: event.officeName,
      p_occurred_at: event.occurredAt,
      p_raw: event.raw ?? {},
    });
    if (error) {
      throw new AppError(ERROR_CODES.PROVIDER_ERROR, error.message);
    }
  }
}

async function refreshLiveTracking(
  organizationId: string,
  shipment: NonNullable<PublicTrackResult["shipment"]>,
  supabase: SupabaseClient
): Promise<{ liveTracking: LiveState; liveMessage: string | null; status?: string | null }> {
  const barcode = shipment.barcode || shipment.trackingNumber;
  if (!barcode) {
    return {
      liveTracking: "unavailable",
      liveMessage: "Live tracking unavailable.",
    };
  }

  const cached = liveCache.get(cacheKey(organizationId, barcode));
  if (cached && cached.expiresAt > Date.now()) {
    return { liveTracking: "ok", liveMessage: null, status: cached.status };
  }

  if (!hasAdminClient()) {
    return {
      liveTracking: "unavailable",
      liveMessage: "Live tracking unavailable.",
    };
  }

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!connection || (connection.status !== "CONNECTED" && !connection.encrypted_username)) {
    return {
      liveTracking: "not_connected",
      liveMessage: "India Post is not connected.",
    };
  }

  try {
    const provider = indiaPostFromRow(connection);
    const result = (await provider.trackShipment([barcode])) as { data?: ProviderArticle[] };
    const article =
      result.data?.find((item) => item.booking_details?.article_number === barcode) ?? result.data?.[0];
    const incoming = (article?.tracking_details ?? []).map((event) => ({
      eventCode: event.event_code || event.event || "EVENT",
      eventDescription: event.event ?? null,
      officeName: event.office ?? null,
      occurredAt: eventOccurredAt(event),
      raw: event,
    }));

    if (incoming.length) {
      await persistEvents(organizationId, shipment.id, incoming, supabase);
    }

    const delivered = article?.del_status?.del_status?.toLowerCase() === "delivered";
    if (delivered) {
      await admin.from("shipments").update({ status: "DELIVERED" }).eq("id", shipment.id);
    }

    liveCache.set(cacheKey(organizationId, barcode), {
      expiresAt: Date.now() + LIVE_TTL_MS,
      events: incoming,
      status: delivered ? "DELIVERED" : shipment.status,
    });

    return {
      liveTracking: "ok",
      liveMessage: null,
      status: delivered ? "DELIVERED" : undefined,
    };
  } catch {
    return {
      liveTracking: "unavailable",
      liveMessage: "Live tracking unavailable.",
    };
  }
}

export async function publicTrackLookup(
  supabase: SupabaseClient,
  subdomain: string,
  query: string
): Promise<PublicTrackResult> {
  const page = await getPublishedTrackingPage(supabase, subdomain);
  if (!page) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This tracking page is not available.");
  }

  const stored = await loadStoredShipment(supabase, page.organizationId, query.trim());
  if (!stored) {
    return {
      found: false,
      liveTracking: "unavailable",
      liveMessage: null,
      shipment: null,
    };
  }

  const live = await refreshLiveTracking(page.organizationId, stored, supabase);
  const refreshed =
    live.liveTracking === "ok"
      ? await loadStoredShipment(supabase, page.organizationId, query.trim())
      : stored;

  return {
    found: true,
    liveTracking: live.liveTracking,
    liveMessage: live.liveMessage,
    shipment: refreshed
      ? {
          ...refreshed,
          status: live.status ?? refreshed.status,
        }
      : stored,
  };
}

export function resolveRequestSubdomain(
  host: string | null,
  headerSubdomain: string | null,
  querySubdomain: string | null,
  bodySubdomain?: string | null
) {
  const fromHost = parseTrackingSubdomain(host);
  if (fromHost) return fromHost;
  return (headerSubdomain || querySubdomain || bodySubdomain || "").trim().toLowerCase() || null;
}
