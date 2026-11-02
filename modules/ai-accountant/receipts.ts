import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";

export const AI_ACCOUNTANT_BUCKET = "ai-accountant";
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Magic-byte check so a renamed file cannot pose as a receipt. */
export function sniffReceiptType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45)
    return "image/webp";
  return null;
}

/** Stores a receipt for an expense or purchase and records its path. */
export async function attachReceipt(
  supabase: SupabaseClient,
  organizationId: string,
  target: { table: "expenses" | "purchase_invoices"; id: string },
  file: File
) {
  if (file.size > MAX_RECEIPT_BYTES) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Receipts must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffReceiptType(bytes);
  if (!type) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Upload a PDF, JPG, PNG or WebP receipt.");
  const { data: existing } = await supabase
    .from(target.table)
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", target.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Record not found.");
  const path = `${organizationId}/receipts/${target.table}/${target.id}.${RECEIPT_TYPES[type]}`;
  const { error } = await supabase.storage.from(AI_ACCOUNTANT_BUCKET).upload(path, bytes, { upsert: true, contentType: type });
  if (error) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not store the receipt.");
  await supabase.from(target.table).update({ receipt_path: path }).eq("organization_id", organizationId).eq("id", target.id);
  return { path };
}

/** Short-lived download link for a stored file inside the organization's folder. */
export async function signedUrl(supabase: SupabaseClient, organizationId: string, path: string, seconds = 300) {
  if (!path.startsWith(`${organizationId}/`)) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "File not found.");
  const { data, error } = await supabase.storage.from(AI_ACCOUNTANT_BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new AppError(ERROR_CODES.JOB_FAILED, "Could not create a download link.");
  return data.signedUrl;
}
