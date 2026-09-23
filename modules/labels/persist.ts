import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { saveLabelPdf } from "@/modules/labels/storage";
import type { LabelTemplate } from "@/modules/labels/template-schema";

export type LabelKind = "INDIA_POST" | "MERCHANT";

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365;

async function uploadLabelToBucket(
  supabase: SupabaseClient,
  path: string,
  bytes: Buffer | Uint8Array
) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const clients = [supabase];
  if (hasAdminClient()) {
    try {
      clients.unshift(createAdminClient());
    } catch {
      // Session client can still upload when the folder belongs to the org.
    }
  }

  for (const client of clients) {
    const uploaded = await client.storage.from("labels").upload(path, body, {
      contentType: "application/pdf",
      upsert: false,
    });
    const exists = Boolean(uploaded.error && /already exists|Duplicate|resource already/i.test(uploaded.error.message));
    if (uploaded.error && !exists) continue;
    const { data: signed } = await client.storage.from("labels").createSignedUrl(path, SIGNED_URL_SECONDS);
    if (signed?.signedUrl) return signed.signedUrl;
  }
  logError("LABEL_BUCKET_UPLOAD_FAILED", { filePath: path });
  return null;
}

export async function persistLabelPdf(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    shipmentId: string;
    kind: LabelKind;
    bytes: Buffer | Uint8Array;
    templateSnapshot?: LabelTemplate | null;
  }
) {
  const id = randomUUID();
  const path = await saveLabelPdf({
    organizationId: input.organizationId,
    shipmentId: input.shipmentId,
    fileId: id,
    bytes: input.bytes,
  });
  let fileUrl: string | null = null;
  try {
    fileUrl = await uploadLabelToBucket(supabase, path, input.bytes);
  } catch (error) {
    logError("LABEL_BUCKET_UPLOAD_FAILED", {
      organizationId: input.organizationId,
      shipmentId: input.shipmentId,
      labelId: id,
      filePath: path,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  const { data, error } = await supabase
    .from("labels")
    .insert({
      id,
      organization_id: input.organizationId,
      shipment_id: input.shipmentId,
      file_path: path,
      file_url: fileUrl,
      mime_type: "application/pdf",
      status: "READY",
      kind: input.kind,
      template_snapshot: input.templateSnapshot ?? null,
    })
    .select("id, file_path, file_url, kind")
    .single();
  if (error || !data) {
    throw Object.assign(new Error(error?.message || "Could not save the label."), {
      code: "LABEL_GENERATION_FAILED",
    });
  }
  return data as { id: string; file_path: string; file_url: string | null; kind: LabelKind };
}
