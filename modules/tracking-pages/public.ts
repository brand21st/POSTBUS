import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orExact } from "@/lib/api/filters";
import { titleCase } from "@/lib/format";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { ingestBulkTrackingArticle, snapshotFromShipmentRow } from "@/modules/india-post/apply-tracking";
import type { PublicTrackResult, PublicTrackingEvent } from "@/types/api";
import { indiaPostServiceLabel } from "@/types/domain";
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

const SHIPMENT_DETAIL_COLUMNS =
  "id, organization_id, barcode, tracking_number, status, operational_status, order_id, shipping_address_id, pickup_location_id, service_code, payment_mode, cod_amount, weight_grams, booked_at, last_event_at";

const ORG_SHIPMENT_DETAIL_COLUMNS =
  "id, barcode, tracking_number, status, operational_status, order_id, shipping_address_id, pickup_location_id, service_code, payment_mode, cod_amount, weight_grams, booked_at, last_event_at";

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

type StoredShipmentRow = {
  organizationId?: string;
  id: string;
  barcode?: string | null;
  trackingNumber?: string | null;
  tracking_number?: string | null;
  status?: string | null;
  operationalStatus?: string | null;
  operational_status?: string | null;
  orderNumber?: string | null;
  serviceCode?: string | null;
  service_code?: string | null;
  serviceLabel?: string | null;
  originCity?: string | null;
  originState?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  bookedAt?: string | null;
  booked_at?: string | null;
  lastUpdatedAt?: string | null;
  last_event_at?: string | null;
  weightGrams?: number | null;
  weight_grams?: number | null;
  paymentMode?: string | null;
  payment_mode?: string | null;
  codAmount?: number | string | null;
  cod_amount?: number | string | null;
  events?: PublicTrackingEvent[] | null;
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

function customerServiceLabel(code?: string | null) {
  if (!code?.trim()) return null;
  const label = indiaPostServiceLabel(code);
  if (!label || label === "—") return null;
  if (label === code) return titleCase(code);
  return label;
}

function customerPaymentMode(mode?: string | null) {
  const key = (mode ?? "").trim().toUpperCase();
  if (key === "COD") return "COD";
  if (key === "PREPAID" || key === "PRE-PAID") return "Prepaid";
  return null;
}

function customerCodAmount(mode?: string | null, amount?: number | string | null) {
  if (customerPaymentMode(mode) !== "COD") return null;
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function redactShipment(input: StoredShipmentRow): NonNullable<PublicTrackResult["shipment"]> {
  const paymentSource = input.paymentMode ?? input.payment_mode;
  const events = input.events ?? [];
  const lastEventAt = events.find((event) => event.occurredAt)?.occurredAt ?? null;
  return {
    id: input.id,
    barcode: input.barcode ?? null,
    trackingNumber: input.trackingNumber ?? input.tracking_number ?? null,
    status: input.status ?? null,
    operationalStatus: input.operationalStatus ?? input.operational_status ?? null,
    orderNumber: input.orderNumber ?? null,
    serviceLabel: input.serviceLabel ?? customerServiceLabel(input.serviceCode ?? input.service_code),
    originCity: input.originCity ?? null,
    originState: input.originState ?? null,
    destinationCity: input.destinationCity ?? null,
    destinationState: input.destinationState ?? null,
    bookedAt: input.bookedAt ?? input.booked_at ?? null,
    lastUpdatedAt: input.lastUpdatedAt ?? input.last_event_at ?? lastEventAt,
    weightGrams: input.weightGrams ?? input.weight_grams ?? null,
    paymentMode: customerPaymentMode(paymentSource),
    codAmount: customerCodAmount(paymentSource, input.codAmount ?? input.cod_amount),
    events: events.map((event) => ({
      id: event.id,
      eventCode: event.eventCode ?? null,
      eventDescription: event.eventDescription ?? null,
      officeName: event.officeName ?? null,
      occurredAt: event.occurredAt ?? null,
    })),
  };
}

async function loadShipmentRelations(
  admin: ReturnType<typeof createAdminClient>,
  shipment: {
    id: string;
    order_id?: string | null;
    shipping_address_id?: string | null;
    pickup_location_id?: string | null;
  }
) {
  const [{ data: order }, { data: address }, { data: pickup }, { data: events }] = await Promise.all([
    shipment.order_id
      ? admin.from("orders").select("order_number").eq("id", shipment.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
    shipment.shipping_address_id
      ? admin.from("addresses").select("city, state").eq("id", shipment.shipping_address_id).maybeSingle()
      : Promise.resolve({ data: null }),
    shipment.pickup_location_id
      ? admin.from("pickup_locations").select("city, state").eq("id", shipment.pickup_location_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("tracking_events")
      .select("id, event_code, event_description, office_name, occurred_at")
      .eq("shipment_id", shipment.id)
      .order("occurred_at", { ascending: false }),
  ]);

  return {
    orderNumber: order?.order_number ?? null,
    destinationCity: address?.city ?? null,
    destinationState: address?.state ?? null,
    originCity: pickup?.city ?? null,
    originState: pickup?.state ?? null,
    events: (events ?? []).map((event) => ({
      id: event.id,
      eventCode: event.event_code,
      eventDescription: event.event_description,
      officeName: event.office_name,
      occurredAt: event.occurred_at,
    })),
  };
}

type StoredShipmentMatch = {
  organizationId: string;
  shipment: NonNullable<PublicTrackResult["shipment"]>;
};

async function loadGlobalStoredShipment(
  supabase: SupabaseClient,
  query: string
): Promise<StoredShipmentMatch | null> {
  if (hasAdminClient()) {
    const admin = createAdminClient();
    const filter = orExact(["barcode", "tracking_number"], query);
    if (!filter) return null;
    const { data: shipments } = await admin
      .from("shipments")
      .select(SHIPMENT_DETAIL_COLUMNS)
      .or(filter)
      .order("updated_at", { ascending: false })
      .limit(1);
    const shipment = shipments?.[0];
    if (!shipment) return null;

    const related = await loadShipmentRelations(admin, shipment);
    return {
      organizationId: shipment.organization_id,
      shipment: redactShipment({
        id: shipment.id,
        barcode: shipment.barcode,
        trackingNumber: shipment.tracking_number,
        status: shipment.status,
        operationalStatus: shipment.operational_status,
        serviceCode: shipment.service_code,
        paymentMode: shipment.payment_mode,
        codAmount: shipment.cod_amount,
        weightGrams: shipment.weight_grams,
        bookedAt: shipment.booked_at,
        lastUpdatedAt: shipment.last_event_at,
        ...related,
      }),
    };
  }

  const { data, error } = await supabase.rpc("public_find_shipment_global", {
    p_query: query,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) return null;
  const row = data as StoredShipmentRow & { organizationId: string };
  return {
    organizationId: row.organizationId,
    shipment: redactShipment(row),
  };
}

async function loadStoredShipment(
  supabase: SupabaseClient,
  organizationId: string,
  query: string
): Promise<NonNullable<PublicTrackResult["shipment"]> | null> {
  if (hasAdminClient()) {
    const admin = createAdminClient();
    const filter = orExact(["barcode", "tracking_number"], query);
    if (!filter) return null;
    const { data: shipment } = await admin
      .from("shipments")
      .select(ORG_SHIPMENT_DETAIL_COLUMNS)
      .eq("organization_id", organizationId)
      .or(filter)
      .maybeSingle();
    if (!shipment) return null;

    const related = await loadShipmentRelations(admin, shipment);
    return redactShipment({
      id: shipment.id,
      barcode: shipment.barcode,
      trackingNumber: shipment.tracking_number,
      status: shipment.status,
      operationalStatus: shipment.operational_status,
      serviceCode: shipment.service_code,
      paymentMode: shipment.payment_mode,
      codAmount: shipment.cod_amount,
      weightGrams: shipment.weight_grams,
      bookedAt: shipment.booked_at,
      lastUpdatedAt: shipment.last_event_at,
      ...related,
    });
  }

  const { data, error } = await supabase.rpc("public_find_shipment", {
    p_organization_id: organizationId,
    p_query: query,
  });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) return null;
  return redactShipment(data as StoredShipmentRow);
}

async function refreshLiveTracking(
  organizationId: string,
  shipment: NonNullable<PublicTrackResult["shipment"]>
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
    const { data: row } = await admin
      .from("shipments")
      .select(
        "id, organization_id, order_id, status, operational_status, last_event_at, ndr_attempt_count, rto_initiated_at"
      )
      .eq("organization_id", organizationId)
      .eq("id", shipment.id)
      .maybeSingle();
    const ingested =
      article && row
        ? await ingestBulkTrackingArticle(admin, {
            organizationId,
            shipment: snapshotFromShipmentRow(row, organizationId),
            article,
          })
        : null;
    const incoming = (article?.tracking_details ?? []).map((event) => ({
      eventCode: event.event_code || event.event || "EVENT",
      eventDescription: event.event ?? null,
      officeName: event.office ?? null,
      occurredAt: eventOccurredAt(event),
    }));

    liveCache.set(cacheKey(organizationId, barcode), {
      expiresAt: Date.now() + LIVE_TTL_MS,
      events: incoming,
      status: ingested?.snapshot.status ?? shipment.status,
    });

    return {
      liveTracking: "ok",
      liveMessage: null,
      status: ingested?.snapshot.status ?? shipment.status,
    };
  } catch {
    return {
      liveTracking: "unavailable",
      liveMessage: "Live tracking unavailable.",
    };
  }
}

async function buildTrackResult(
  supabase: SupabaseClient,
  organizationId: string,
  query: string,
  stored: NonNullable<PublicTrackResult["shipment"]>
): Promise<PublicTrackResult> {
  const live = await refreshLiveTracking(organizationId, stored);
  const refreshed =
    live.liveTracking === "ok"
      ? await loadStoredShipment(supabase, organizationId, query)
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

export async function publicApexTrackLookup(
  supabase: SupabaseClient,
  query: string
): Promise<PublicTrackResult> {
  const match = await loadGlobalStoredShipment(supabase, query.trim());
  if (!match) {
    return {
      found: false,
      liveTracking: "unavailable",
      liveMessage: null,
      shipment: null,
    };
  }

  return buildTrackResult(supabase, match.organizationId, query.trim(), match.shipment);
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

  return buildTrackResult(supabase, page.organizationId, query.trim(), stored);
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
