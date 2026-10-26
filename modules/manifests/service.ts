import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import {
  MANIFEST_ELIGIBLE_DAYS,
  MANIFEST_ELIGIBLE_STATUSES,
  MANIFEST_PROOF_MAX_BYTES,
  MANIFEST_PROOF_TYPES,
  MANIFEST_SWEEP_STATUSES,
  MANIFEST_UNSCANNED_GRACE_MS,
  type ManifestHandoverInput,
  type ManifestListQuery,
  type ManifestStatus,
} from "@/modules/manifests/schema";
import { getAutomationSettings } from "@/modules/automation/service";
import { createBackgroundJob } from "@/modules/jobs/service";
import { indiaPostServiceLabel } from "@/types/domain";

export type ManifestRow = {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  manifest_number: string | null;
  manifest_date: string;
  office_id: string | null;
  office_name: string | null;
  shipment_count: number;
  created_at: string;
  updated_at?: string | null;
  closed_at: string | null;
  reopened_at?: string | null;
  handed_over_at: string | null;
  handed_over_to: string | null;
  handover_notes: string | null;
  proof_path: string | null;
};

export type ManifestSummary = {
  id: string;
  name: string;
  number: string | null;
  status: ManifestStatus;
  date: string;
  officeId: string | null;
  officeName: string | null;
  shipmentCount: number;
  createdAt: string;
  closedAt: string | null;
  reopenedAt: string | null;
  handedOverAt: string | null;
  handedOverTo: string | null;
  handoverNotes: string | null;
  hasProof: boolean;
};

export type ManifestLine = {
  shipmentId: string;
  barcode: string;
  orderNumber: string | null;
  consignee: string | null;
  city: string | null;
  pincode: string | null;
  serviceCode: string | null;
  serviceLabel: string;
  weightGrams: number;
  paymentMode: string | null;
  codAmount: number;
  tariffAmount: number | null;
  shipmentStatus: string;
  addedAt: string | null;
  /** Null until the manifest is handed over. */
  scanned: boolean | null;
};

export type ManifestTotals = {
  count: number;
  weightGrams: number;
  codCount: number;
  codAmount: number;
  tariffAmount: number;
  byService: Array<{ code: string; label: string; count: number; weightGrams: number }>;
};

export type ManifestDetail = ManifestSummary & {
  lines: ManifestLine[];
  totals: ManifestTotals;
  unscannedCount: number;
};

export type ManifestSender = {
  name: string;
  customerId: string | null;
};

type Office = { id: string | null; name: string | null };
type OfficeConnection = {
  bulk_customer_id?: string | null;
  pickup_dropoff_office_id?: string | null;
  pickup_dropoff_office_name?: string | null;
  pickup_office_id?: string | null;
  pickup_office_name?: string | null;
} | null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRE_DISPATCH = new Set<string>(MANIFEST_ELIGIBLE_STATUSES);

const MANIFEST_COLUMNS =
  "id, organization_id, name, status, manifest_number, manifest_date, office_id, office_name, shipment_count, created_at, updated_at, closed_at, reopened_at, handed_over_at, handed_over_to, handover_notes, proof_path";

export function istDate(at: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof at === "string" ? new Date(at) : at);
}

function text(value: unknown) {
  const out = String(value ?? "").trim();
  return out || null;
}

function num(value: unknown) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Maps RPC raise codes to API errors (55000 = wrong state, P0002 = not visible / missing). */
function rpcError(error: { code?: string; message?: string }): never {
  const message = error.message || "Manifest update failed.";
  if (error.code === "P0002") throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Manifest not found.");
  if (error.code === "55000" || error.code === "23505") throw new AppError(ERROR_CODES.CONFLICT, message);
  throw new AppError(ERROR_CODES.VALIDATION_ERROR, message);
}

function assertId(id: string) {
  if (!UUID_RE.test(id)) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Manifest not found.");
}

export function mapManifest(row: ManifestRow): ManifestSummary {
  return {
    id: row.id,
    name: row.name,
    number: row.manifest_number,
    status: row.status as ManifestStatus,
    date: row.manifest_date,
    officeId: row.office_id,
    officeName: row.office_name,
    shipmentCount: row.shipment_count ?? 0,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at ?? null,
    handedOverAt: row.handed_over_at,
    handedOverTo: row.handed_over_to,
    handoverNotes: row.handover_notes,
    hasProof: Boolean(row.proof_path),
  };
}

/**
 * Booking office for grouping: what CEPT was booked against, else the workspace's
 * configured drop-off (default) or pickup office.
 */
export function resolveManifestOffice(bookingOfficeId: string | null | undefined, connection: OfficeConnection): Office {
  const dropId = text(connection?.pickup_dropoff_office_id);
  const pickupId = text(connection?.pickup_office_id);
  const id = text(bookingOfficeId) ?? dropId ?? pickupId;
  if (!id) return { id: null, name: null };
  if (id === dropId) return { id, name: text(connection?.pickup_dropoff_office_name) };
  if (id === pickupId) return { id, name: text(connection?.pickup_office_name) };
  return { id, name: null };
}

export function groupForManifests(
  shipments: Array<{ id: string; booking_office_id?: string | null }>,
  connection: OfficeConnection,
  date: string
) {
  const groups = new Map<string, { date: string; office: Office; shipmentIds: string[] }>();
  for (const shipment of shipments) {
    const office = resolveManifestOffice(shipment.booking_office_id, connection);
    const key = `${date}|${office.id ?? ""}`;
    const group = groups.get(key) ?? { date, office, shipmentIds: [] };
    group.shipmentIds.push(shipment.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function loadConnection(supabase: SupabaseClient, organizationId: string): Promise<OfficeConnection> {
  const { data } = await supabase
    .from("india_post_connections")
    .select("bulk_customer_id, pickup_dropoff_office_id, pickup_dropoff_office_name, pickup_office_id, pickup_office_name")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as OfficeConnection) ?? null;
}

async function audit(
  supabase: SupabaseClient,
  organizationId: string,
  actorId: string | null | undefined,
  action: string,
  manifestId: string,
  after?: Record<string, unknown>
) {
  const { error } = await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    actor_id: actorId ?? null,
    action,
    entity_type: "manifest",
    entity_id: manifestId,
    after: after ?? null,
  });
  if (error) logError("MANIFEST_AUDIT_FAILED", { organizationId, manifestId, action, message: error.message });
}

/**
 * Puts shipments on today's open draft for their booking office (creating it if needed).
 * Returns only shipments newly linked by this call, so callers fan out side effects once.
 */
export async function assignToDraft(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentIds: string[],
  options: { userId?: string | null; now?: Date } = {}
) {
  const ids = [...new Set(shipmentIds)].filter((id) => UUID_RE.test(id));
  if (!ids.length) return { added: [] as string[], manifestIds: [] as string[] };
  const { data: rows, error } = await supabase
    .from("shipments")
    .select("id, booking_office_id")
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!rows?.length) return { added: [] as string[], manifestIds: [] as string[] };

  const connection = await loadConnection(supabase, organizationId);
  const added: string[] = [];
  const manifestIds = new Set<string>();
  for (const group of groupForManifests(rows, connection, istDate(options.now))) {
    const { data, error: rpcFailure } = await supabase.rpc("manifest_add_shipments", {
      p_org: organizationId,
      p_date: group.date,
      p_office_id: group.office.id,
      p_office_name: group.office.name,
      p_shipment_ids: group.shipmentIds,
      p_user: options.userId ?? null,
    });
    if (rpcFailure) rpcError(rpcFailure);
    for (const row of (data ?? []) as Array<{ manifest_id: string; shipment_id: string }>) {
      added.push(row.shipment_id);
      manifestIds.add(row.manifest_id);
    }
  }
  return { added, manifestIds: [...manifestIds] };
}

/** Same fan-out the manifest worker does, for shipments manifested from the dashboard. */
export async function enqueueFulfillmentForManifested(
  supabase: SupabaseClient,
  organizationId: string,
  shipmentIds: string[]
) {
  if (!shipmentIds.length) return;
  try {
    const automation = await getAutomationSettings(supabase, organizationId);
    if (!automation.autoShopifyFulfillment) return;
    for (const shipmentId of shipmentIds) {
      await createBackgroundJob(supabase, {
        organizationId,
        jobType: "shopify-fulfillment",
        entityType: "shipment",
        entityId: shipmentId,
      });
    }
  } catch (error) {
    logError("MANIFEST_FULFILLMENT_ENQUEUE_FAILED", {
      organizationId,
      count: shipmentIds.length,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

function eligibleSince(now = new Date()) {
  return new Date(now.getTime() - MANIFEST_ELIGIBLE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

type EligibleRow = {
  id: string;
  barcode: string | null;
  status: string;
  service_code: string | null;
  weight_grams: number | null;
  booked_at: string | null;
  booking_office_id: string | null;
  orders?: { order_number?: string | null } | Array<{ order_number?: string | null }> | null;
  addresses?: { name?: string | null; pincode?: string | null } | Array<{ name?: string | null; pincode?: string | null }> | null;
  manifest_shipments?: Array<{ id: string }> | null;
};

async function unmanifestedShipments(
  supabase: SupabaseClient,
  organizationId: string,
  statuses: readonly string[],
  now?: Date
) {
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id, barcode, status, service_code, weight_grams, booked_at, booking_office_id, orders(order_number), addresses!shipping_address_id(name, pincode), manifest_shipments(id)"
    )
    .eq("organization_id", organizationId)
    .not("barcode", "is", null)
    .in("status", [...statuses])
    .gte("booked_at", eligibleSince(now))
    .order("booked_at", { ascending: true })
    .limit(1000);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return ((data ?? []) as EligibleRow[]).filter((row) => !row.manifest_shipments?.length);
}

/** Moves every labelled shipment that is not on a manifest yet onto today's drafts. */
export async function sweepEligible(
  supabase: SupabaseClient,
  organizationId: string,
  options: { userId?: string | null; now?: Date } = {}
) {
  const rows = await unmanifestedShipments(supabase, organizationId, MANIFEST_SWEEP_STATUSES, options.now);
  return assignToDraft(
    supabase,
    organizationId,
    rows.map((row) => row.id),
    options
  );
}

export async function listEligible(supabase: SupabaseClient, organizationId: string) {
  const connection = await loadConnection(supabase, organizationId);
  const rows = await unmanifestedShipments(supabase, organizationId, MANIFEST_ELIGIBLE_STATUSES);
  return {
    items: rows.map((row) => {
      const office = resolveManifestOffice(row.booking_office_id, connection);
      const address = one(row.addresses);
      return {
        shipmentId: row.id,
        barcode: row.barcode ?? "",
        status: row.status,
        orderNumber: one(row.orders)?.order_number ?? null,
        consignee: address?.name ?? null,
        pincode: address?.pincode ?? null,
        serviceLabel: indiaPostServiceLabel(row.service_code),
        weightGrams: num(row.weight_grams),
        bookedAt: row.booked_at,
        officeId: office.id,
        officeName: office.name,
        hasLabel: row.status !== "BOOKED" && row.status !== "LABEL_PENDING",
      };
    }),
  };
}

async function unscannedHandedOver(supabase: SupabaseClient, organizationId: string, now = new Date()) {
  const { data: manifests, error } = await supabase
    .from("manifests")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "HANDED_OVER")
    .lte("handed_over_at", new Date(now.getTime() - MANIFEST_UNSCANNED_GRACE_MS).toISOString())
    .gte("handed_over_at", eligibleSince(now));
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const ids = (manifests ?? []).map((row) => row.id as string);
  if (!ids.length) return 0;
  const { data: links, error: linkError } = await supabase
    .from("manifest_shipments")
    .select("shipment_id, shipments!inner(status)")
    .in("manifest_id", ids)
    .in("shipments.status", [...MANIFEST_ELIGIBLE_STATUSES])
    .limit(1000);
  if (linkError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, linkError.message);
  const pending = (links ?? []).map((row) => row.shipment_id as string);
  const scanned = await shipmentsWithEvents(supabase, organizationId, pending);
  return pending.filter((id) => !scanned.has(id)).length;
}

async function shipmentsWithEvents(supabase: SupabaseClient, organizationId: string, shipmentIds: string[]) {
  const seen = new Set<string>();
  for (let index = 0; index < shipmentIds.length; index += 200) {
    const chunk = shipmentIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("tracking_events")
      .select("shipment_id")
      .eq("organization_id", organizationId)
      .in("shipment_id", chunk)
      .limit(5000);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    for (const row of data ?? []) seen.add(row.shipment_id as string);
  }
  return seen;
}

export async function listManifests(supabase: SupabaseClient, organizationId: string, query: ManifestListQuery) {
  const from = (query.page - 1) * query.pageSize;
  let builder = supabase
    .from("manifests")
    .select(MANIFEST_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId);
  if (query.status) builder = builder.eq("status", query.status);
  const { data, count, error } = await builder
    .order("manifest_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + query.pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const [drafts, eligible, unscanned] = await Promise.all([
    supabase
      .from("manifests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "DRAFT"),
    unmanifestedShipments(supabase, organizationId, MANIFEST_SWEEP_STATUSES),
    unscannedHandedOver(supabase, organizationId),
  ]);

  return {
    items: ((data ?? []) as ManifestRow[]).map(mapManifest),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
    summary: {
      openDrafts: drafts.count ?? 0,
      awaitingManifest: eligible.length,
      unscannedAfterHandover: unscanned,
    },
  };
}

async function loadManifestRow(supabase: SupabaseClient, organizationId: string, id: string) {
  assertId(id);
  const { data, error } = await supabase
    .from("manifests")
    .select(MANIFEST_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Manifest not found.");
  return data as ManifestRow;
}

type LineRow = {
  added_at: string | null;
  shipments:
    | {
        id: string;
        barcode: string | null;
        tracking_number: string | null;
        status: string;
        service_code: string | null;
        weight_grams: number | null;
        payment_mode: string | null;
        cod_amount: number | string | null;
        tariff_amount: number | string | null;
        orders?: { order_number?: string | null } | Array<{ order_number?: string | null }> | null;
        customers?: { name?: string | null } | Array<{ name?: string | null }> | null;
        addresses?:
          | { name?: string | null; city?: string | null; pincode?: string | null }
          | Array<{ name?: string | null; city?: string | null; pincode?: string | null }>
          | null;
      }
    | null;
};

export function manifestTotals(lines: ManifestLine[]): ManifestTotals {
  const byService = new Map<string, { code: string; label: string; count: number; weightGrams: number }>();
  let weightGrams = 0;
  let codCount = 0;
  let codAmount = 0;
  let tariffAmount = 0;
  for (const line of lines) {
    weightGrams += line.weightGrams;
    tariffAmount += line.tariffAmount ?? 0;
    if (line.codAmount > 0) {
      codCount += 1;
      codAmount += line.codAmount;
    }
    const code = line.serviceCode ?? "UNKNOWN";
    const entry = byService.get(code) ?? { code, label: line.serviceLabel, count: 0, weightGrams: 0 };
    entry.count += 1;
    entry.weightGrams += line.weightGrams;
    byService.set(code, entry);
  }
  return {
    count: lines.length,
    weightGrams,
    codCount,
    codAmount: Math.round(codAmount * 100) / 100,
    tariffAmount: Math.round(tariffAmount * 100) / 100,
    byService: [...byService.values()].sort((a, b) => b.count - a.count),
  };
}

/** A handed-over article counts as scanned once India Post has any event for it or it moved past pickup. */
export function isScanned(status: string, hasEvents: boolean) {
  return hasEvents || !PRE_DISPATCH.has(status);
}

export async function getManifest(supabase: SupabaseClient, organizationId: string, id: string): Promise<ManifestDetail> {
  const row = await loadManifestRow(supabase, organizationId, id);
  const { data, error } = await supabase
    .from("manifest_shipments")
    .select(
      "added_at, shipments(id, barcode, tracking_number, status, service_code, weight_grams, payment_mode, cod_amount, tariff_amount, orders(order_number), customers(name), addresses!shipping_address_id(name, city, pincode))"
    )
    .eq("organization_id", organizationId)
    .eq("manifest_id", id)
    .order("added_at", { ascending: true })
    .limit(5000);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);

  const handedOver = row.status === "HANDED_OVER";
  const rows = ((data ?? []) as unknown as LineRow[]).filter((item) => item.shipments);
  const pending = handedOver
    ? rows.filter((item) => PRE_DISPATCH.has(item.shipments!.status)).map((item) => item.shipments!.id)
    : [];
  const withEvents = pending.length ? await shipmentsWithEvents(supabase, organizationId, pending) : new Set<string>();

  const lines: ManifestLine[] = rows.map((item) => {
    const shipment = item.shipments!;
    const address = one(shipment.addresses);
    return {
      shipmentId: shipment.id,
      barcode: shipment.barcode ?? shipment.tracking_number ?? "",
      orderNumber: one(shipment.orders)?.order_number ?? null,
      consignee: text(address?.name) ?? text(one(shipment.customers)?.name),
      city: address?.city ?? null,
      pincode: address?.pincode ?? null,
      serviceCode: shipment.service_code,
      serviceLabel: indiaPostServiceLabel(shipment.service_code),
      weightGrams: num(shipment.weight_grams),
      paymentMode: shipment.payment_mode,
      codAmount: shipment.payment_mode === "COD" ? num(shipment.cod_amount) : 0,
      tariffAmount: shipment.tariff_amount == null ? null : num(shipment.tariff_amount),
      shipmentStatus: shipment.status,
      addedAt: item.added_at,
      scanned: handedOver ? isScanned(shipment.status, withEvents.has(shipment.id)) : null,
    };
  });

  return {
    ...mapManifest(row),
    lines,
    totals: manifestTotals(lines),
    unscannedCount: lines.filter((line) => line.scanned === false).length,
  };
}

export async function getManifestSender(supabase: SupabaseClient, organizationId: string): Promise<ManifestSender> {
  const [{ data: org }, connection] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    loadConnection(supabase, organizationId),
  ]);
  return {
    name: text(org?.name) ?? "PostBus merchant",
    customerId: text(connection?.bulk_customer_id),
  };
}

export async function addShipments(
  supabase: SupabaseClient,
  organizationId: string,
  manifestId: string,
  shipmentIds: string[],
  userId?: string | null
) {
  await loadManifestRow(supabase, organizationId, manifestId);
  const { data, error } = await supabase.rpc("manifest_add_to", {
    p_manifest: manifestId,
    p_shipment_ids: shipmentIds,
    p_user: userId ?? null,
  });
  if (error) rpcError(error);
  const added = ((data ?? []) as Array<{ shipment_id: string }>).map((row) => row.shipment_id);
  if (added.length) {
    await audit(supabase, organizationId, userId, "manifest.shipments_added", manifestId, { shipmentIds: added });
    await enqueueFulfillmentForManifested(supabase, organizationId, added);
  }
  return { added, skipped: shipmentIds.length - added.length };
}

export async function removeShipment(
  supabase: SupabaseClient,
  organizationId: string,
  manifestId: string,
  shipmentId: string,
  userId?: string | null
) {
  await loadManifestRow(supabase, organizationId, manifestId);
  if (!UUID_RE.test(shipmentId)) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment not found.");
  const { data, error } = await supabase.rpc("manifest_remove_shipment", {
    p_manifest: manifestId,
    p_shipment: shipmentId,
  });
  if (error) rpcError(error);
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Shipment is not on this manifest.");
  await audit(supabase, organizationId, userId, "manifest.shipment_removed", manifestId, { shipmentId });
  return { removed: true };
}

export async function closeManifest(supabase: SupabaseClient, organizationId: string, manifestId: string, userId?: string | null) {
  await loadManifestRow(supabase, organizationId, manifestId);
  const { error } = await supabase.rpc("manifest_close", { p_manifest: manifestId, p_user: userId ?? null });
  if (error) rpcError(error);
  const row = await loadManifestRow(supabase, organizationId, manifestId);
  await audit(supabase, organizationId, userId, "manifest.closed", manifestId, {
    number: row.manifest_number,
    shipmentCount: row.shipment_count,
  });
  return mapManifest(row);
}

export async function reopenManifest(supabase: SupabaseClient, organizationId: string, manifestId: string, userId?: string | null) {
  await loadManifestRow(supabase, organizationId, manifestId);
  const { error } = await supabase.rpc("manifest_reopen", { p_manifest: manifestId });
  if (error) rpcError(error);
  await audit(supabase, organizationId, userId, "manifest.reopened", manifestId);
  return mapManifest(await loadManifestRow(supabase, organizationId, manifestId));
}

export function proofExtension(contentType: string) {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  return null;
}

export async function markHandedOver(
  supabase: SupabaseClient,
  organizationId: string,
  manifestId: string,
  input: ManifestHandoverInput & { proof?: { bytes: Uint8Array; contentType: string } | null },
  userId?: string | null
) {
  const row = await loadManifestRow(supabase, organizationId, manifestId);
  if (row.status !== "CLOSED") {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      row.status === "DRAFT" ? "Close the manifest before marking it handed over." : "This manifest is already handed over."
    );
  }

  let proofPath: string | null = null;
  if (input.proof) {
    const ext = proofExtension(input.proof.contentType);
    if (!ext || !(MANIFEST_PROOF_TYPES as readonly string[]).includes(input.proof.contentType)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PDF, JPG or PNG copy of the signed manifest.");
    }
    if (input.proof.bytes.byteLength > MANIFEST_PROOF_MAX_BYTES) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "The signed copy must be 10 MB or smaller.");
    }
    // Unique name: tenants have no storage update policy, so never overwrite.
    proofPath = `${organizationId}/${manifestId}-handover-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("manifests").upload(proofPath, input.proof.bytes, {
      contentType: input.proof.contentType,
      upsert: false,
    });
    if (uploadError) {
      throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not upload the signed copy. Try again.");
    }
  }

  const { data, error } = await supabase
    .from("manifests")
    .update({
      status: "HANDED_OVER",
      handed_over_at: new Date().toISOString(),
      handed_over_by: userId ?? null,
      handed_over_to: input.handedOverTo ?? null,
      handover_notes: input.notes ?? null,
      proof_path: proofPath,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", manifestId)
    .eq("status", "CLOSED")
    .select(MANIFEST_COLUMNS)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) throw new AppError(ERROR_CODES.CONFLICT, "This manifest changed. Refresh and try again.");
  await audit(supabase, organizationId, userId, "manifest.handed_over", manifestId, {
    handedOverTo: input.handedOverTo ?? null,
    proof: Boolean(proofPath),
  });
  return mapManifest(data as ManifestRow);
}

export async function manifestProofUrl(supabase: SupabaseClient, organizationId: string, manifestId: string) {
  const row = await loadManifestRow(supabase, organizationId, manifestId);
  if (!row.proof_path) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No signed copy was uploaded.");
  const { data, error } = await supabase.storage.from("manifests").createSignedUrl(row.proof_path, 300);
  if (error || !data?.signedUrl) throw new AppError(ERROR_CODES.PROVIDER_ERROR, "Could not open the signed copy.");
  return data.signedUrl;
}

/** Manifest link for the shipment detail page. */
export async function manifestForShipment(supabase: SupabaseClient, organizationId: string, shipmentId: string) {
  let data: { manifests?: unknown } | null = null;
  try {
    ({ data } = await supabase
      .from("manifest_shipments")
      .select("manifests(id, manifest_number, status, manifest_date)")
      .eq("organization_id", organizationId)
      .eq("shipment_id", shipmentId)
      .maybeSingle());
  } catch {
    // The link is decoration on shipment detail; never fail the page for it.
    return null;
  }
  const manifest = one(
    (data?.manifests ?? null) as
      | { id: string; manifest_number: string | null; status: string; manifest_date: string }
      | Array<{ id: string; manifest_number: string | null; status: string; manifest_date: string }>
      | null
  );
  if (!manifest) return null;
  return { id: manifest.id, number: manifest.manifest_number, status: manifest.status, date: manifest.manifest_date };
}
