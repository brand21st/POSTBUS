import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { parcelServiceCode } from "@/modules/india-post/booking-service";
import {
  PARCEL_HEIGHT_MAX_CM,
  PARCEL_HEIGHT_MIN_CM,
  PARCEL_LENGTH_MAX_CM,
  PARCEL_LENGTH_MIN_CM,
  PARCEL_WIDTH_MAX_CM,
  PARCEL_WIDTH_MIN_CM,
} from "@/modules/india-post/parcel-defaults";
import { INDIA_POST_WEIGHT_MAX_G, INDIA_POST_WEIGHT_MIN_G } from "@/modules/india-post/weight";
import { DEFAULT_INDIA_POST_SERVICE } from "@/types/domain";

export const SHIPMENT_PRESET_MAX = 12;
export const SHIPMENT_PRESET_NAME_MAX = 40;

const PRESET_COLUMNS =
  "id, user_id, name, weight_grams, length_cm, width_cm, height_cm, service_code, created_at, updated_at, last_used_at";

export const createShipmentPresetSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(SHIPMENT_PRESET_NAME_MAX, "Name is too long."),
  weightGrams: z.coerce.number().int().min(INDIA_POST_WEIGHT_MIN_G).max(INDIA_POST_WEIGHT_MAX_G),
  lengthCm: z.coerce.number().min(PARCEL_LENGTH_MIN_CM).max(PARCEL_LENGTH_MAX_CM),
  widthCm: z.coerce.number().min(PARCEL_WIDTH_MIN_CM).max(PARCEL_WIDTH_MAX_CM),
  heightCm: z.coerce.number().min(PARCEL_HEIGHT_MIN_CM).max(PARCEL_HEIGHT_MAX_CM),
  serviceCode: z.string().optional(),
});

export type ShipmentPresetInput = z.infer<typeof createShipmentPresetSchema>;

export type ShipmentPreset = {
  id: string;
  /** Workspace member who saved it. Every member can use it. */
  createdBy: string | null;
  name: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  serviceCode: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

function mapPreset(row: {
  id: string;
  user_id?: string | null;
  name: string;
  weight_grams: number;
  length_cm: number | string;
  width_cm: number | string;
  height_cm: number | string;
  service_code: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}): ShipmentPreset {
  return {
    id: row.id,
    createdBy: row.user_id ?? null,
    name: row.name,
    weightGrams: Number(row.weight_grams),
    lengthCm: Number(row.length_cm),
    widthCm: Number(row.width_cm),
    heightCm: Number(row.height_cm),
    serviceCode: row.service_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

function requireService(value?: string | null) {
  const code = parcelServiceCode(value) ?? (value ? null : DEFAULT_INDIA_POST_SERVICE);
  if (!code) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose Speed Post parcel or Business Parcel.");
  }
  return code;
}

function isUniqueNameError(error: { code?: string; message?: string } | null) {
  const message = (error?.message ?? "").toLowerCase();
  return error?.code === "23505" || message.includes("user_shipment_presets_name_unique");
}

export function shipmentPresetPackError(input: {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}): string | null {
  if (
    !Number.isFinite(input.weightGrams) ||
    input.weightGrams < INDIA_POST_WEIGHT_MIN_G ||
    input.weightGrams > INDIA_POST_WEIGHT_MAX_G
  ) {
    return `Weight must be between ${INDIA_POST_WEIGHT_MIN_G} and ${INDIA_POST_WEIGHT_MAX_G} grams.`;
  }
  if (input.lengthCm < PARCEL_LENGTH_MIN_CM || input.lengthCm > PARCEL_LENGTH_MAX_CM) {
    return `Length must be between ${PARCEL_LENGTH_MIN_CM} and ${PARCEL_LENGTH_MAX_CM} cm.`;
  }
  if (input.widthCm < PARCEL_WIDTH_MIN_CM || input.widthCm > PARCEL_WIDTH_MAX_CM) {
    return `Width must be between ${PARCEL_WIDTH_MIN_CM} and ${PARCEL_WIDTH_MAX_CM} cm.`;
  }
  if (input.heightCm < PARCEL_HEIGHT_MIN_CM || input.heightCm > PARCEL_HEIGHT_MAX_CM) {
    return `Height must be between ${PARCEL_HEIGHT_MIN_CM} and ${PARCEL_HEIGHT_MAX_CM} cm.`;
  }
  return null;
}

export async function listShipmentPresets(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<ShipmentPreset[]> {
  void userId; // Shared by the workspace; any member may read, use or remove it.
  const { data, error } = await supabase
    .from("user_shipment_presets")
    .select(PRESET_COLUMNS)
    .eq("organization_id", organizationId)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load pack sizes.");
  }

  return (data ?? []).map(mapPreset);
}

export async function createShipmentPreset(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  input: ShipmentPresetInput
): Promise<ShipmentPreset> {
  const packError = shipmentPresetPackError(input);
  if (packError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, packError);
  const serviceCode = requireService(input.serviceCode);

  // Pack sizes are shared by the workspace: the cap and the name are checked per workspace.
  const { data: existing, error: countError } = await supabase
    .from("user_shipment_presets")
    .select("id, name")
    .eq("organization_id", organizationId);

  if (countError) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not save the pack size.");
  }
  const rows = (existing ?? []) as Array<{ id: string; name: string }>;
  if (rows.length >= SHIPMENT_PRESET_MAX) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `You can save up to ${SHIPMENT_PRESET_MAX} pack sizes.`);
  }
  const wanted = input.name.trim().toLowerCase();
  if (rows.some((row) => String(row.name ?? "").trim().toLowerCase() === wanted)) {
    throw new AppError(ERROR_CODES.CONFLICT, "A pack size with that name already exists. Rename it.");
  }

  const { data, error } = await supabase
    .from("user_shipment_presets")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      name: input.name.trim(),
      weight_grams: Math.round(input.weightGrams),
      length_cm: input.lengthCm,
      width_cm: input.widthCm,
      height_cm: input.heightCm,
      service_code: serviceCode,
    })
    .select(PRESET_COLUMNS)
    .single();

  if (isUniqueNameError(error)) {
    throw new AppError(ERROR_CODES.CONFLICT, "A pack size with that name already exists. Rename it.");
  }
  if (error || !data) {
    throw new AppError(ERROR_CODES.JOB_FAILED, error?.message || "Could not save the pack size.");
  }
  return mapPreset(data);
}

export async function touchShipmentPreset(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  presetId: string
): Promise<ShipmentPreset> {
  void userId; // Shared by the workspace; any member may read, use or remove it.
  const { data, error } = await supabase
    .from("user_shipment_presets")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", presetId)
    .eq("organization_id", organizationId)
    .select(PRESET_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not update the pack size.");
  }
  if (!data) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Pack size not found.");
  }
  return mapPreset(data);
}

export async function deleteShipmentPreset(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  presetId: string
): Promise<{ id: string }> {
  void userId; // Shared by the workspace; any member may read, use or remove it.
  const { data, error } = await supabase
    .from("user_shipment_presets")
    .delete()
    .eq("id", presetId)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not remove the pack size.");
  }
  if (!data) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Pack size not found.");
  }
  return { id: data.id };
}
