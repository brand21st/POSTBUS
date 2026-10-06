import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export const TABLE_LAYOUT_KEYS = ["orders"] as const;
export type TableLayoutKey = (typeof TABLE_LAYOUT_KEYS)[number];

const tableKeySchema = z.enum(TABLE_LAYOUT_KEYS);
const columnIdSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/i);
const columnWidthSchema = z.number().int().min(48).max(800);

export const saveTableLayoutSchema = z.object({
  columnWidths: z.record(columnIdSchema, columnWidthSchema),
});

export type TableLayout = {
  tableKey: TableLayoutKey;
  columnWidths: Record<string, number>;
};

function asTableKey(value: string): TableLayoutKey {
  const parsed = tableKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unknown table layout.");
  }
  return parsed.data;
}

function sanitizeWidths(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = columnIdSchema.safeParse(key);
    const width = columnWidthSchema.safeParse(raw);
    if (id.success && width.success) next[id.data] = width.data;
  }
  return next;
}

export async function getTableLayout(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  tableKey: string
): Promise<TableLayout> {
  const key = asTableKey(tableKey);
  const { data, error } = await supabase
    .from("user_table_layouts")
    .select("column_widths")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("table_key", key)
    .maybeSingle();

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not load table layout.");
  }

  return {
    tableKey: key,
    columnWidths: sanitizeWidths(data?.column_widths),
  };
}

export async function saveTableLayout(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string,
  tableKey: string,
  columnWidths: Record<string, number>
): Promise<TableLayout> {
  const key = asTableKey(tableKey);
  const widths = sanitizeWidths(columnWidths);
  const { data, error } = await supabase
    .from("user_table_layouts")
    .upsert(
      {
        user_id: userId,
        organization_id: organizationId,
        table_key: key,
        column_widths: widths,
      },
      { onConflict: "user_id,organization_id,table_key" }
    )
    .select("column_widths")
    .single();

  if (error) {
    throw new AppError(ERROR_CODES.JOB_FAILED, "Could not save table layout.");
  }

  return {
    tableKey: key,
    columnWidths: sanitizeWidths(data?.column_widths),
  };
}
