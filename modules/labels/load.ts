import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError } from "@/lib/logger";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { readLabelPdfIfPresent } from "@/modules/labels/storage";

export type LabelFileRow = {
  id: string;
  file_path: string;
  file_url?: string | null;
  shipment_id?: string | null;
};

function isPdf(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

async function downloadFromBucket(client: SupabaseClient, filePath: string) {
  const file = await client.storage.from("labels").download(filePath);
  if (!file.data) return null;
  const bytes = Buffer.from(await file.data.arrayBuffer());
  return isPdf(bytes) ? bytes : null;
}

async function downloadFromUrl(url: string | null | undefined) {
  if (!url?.startsWith("http://") && !url?.startsWith("https://")) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return isPdf(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function loadLabelPdfBytes(
  supabase: SupabaseClient,
  organizationId: string,
  label: LabelFileRow
) {
  if (label.file_path) {
    const fromDisk = await readLabelPdfIfPresent({
      relativePath: label.file_path,
      organizationId,
      labelId: label.id,
      shipmentId: label.shipment_id ?? undefined,
    });
    if (fromDisk && isPdf(fromDisk)) {
      void syncLabelToBucket(supabase, organizationId, label, fromDisk);
      return fromDisk;
    }

    const fromUserBucket = await downloadFromBucket(supabase, label.file_path);
    if (fromUserBucket) return fromUserBucket;

    if (hasAdminClient()) {
      const fromAdminBucket = await downloadFromBucket(createAdminClient(), label.file_path);
      if (fromAdminBucket) return fromAdminBucket;
    }
  }

  const fromUrl = await downloadFromUrl(label.file_url);
  if (fromUrl) return fromUrl;

  if (label.file_path) {
    const signed = await signedUrlFromBucket(supabase, label.file_path);
    if (signed) return signed;
    if (hasAdminClient()) {
      const adminSigned = await signedUrlFromBucket(createAdminClient(), label.file_path);
      if (adminSigned) return adminSigned;
    }
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Label file not found.");
}

async function signedUrlFromBucket(client: SupabaseClient, filePath: string) {
  const { data } = await client.storage.from("labels").createSignedUrl(filePath, 60);
  return downloadFromUrl(data?.signedUrl);
}

const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365;

async function syncLabelToBucket(
  supabase: SupabaseClient,
  organizationId: string,
  label: LabelFileRow,
  bytes: Buffer
) {
  if (!label.file_path || label.file_url) return;
  const clients = [supabase];
  if (hasAdminClient()) {
    try {
      clients.unshift(createAdminClient());
    } catch {
      // Session client can still upload when the folder belongs to the org.
    }
  }
  try {
    for (const client of clients) {
      const uploaded = await client.storage.from("labels").upload(label.file_path, bytes, {
        contentType: "application/pdf",
        upsert: false,
      });
      const exists = Boolean(
        uploaded.error && /already exists|Duplicate|resource already/i.test(uploaded.error.message ?? "")
      );
      if (uploaded.error && !exists) continue;
      const { data: signed } = await client.storage
        .from("labels")
        .createSignedUrl(label.file_path, SIGNED_URL_SECONDS);
      if (!signed?.signedUrl) continue;
      await client
        .from("labels")
        .update({ file_url: signed.signedUrl })
        .eq("file_path", label.file_path)
        .eq("organization_id", organizationId)
        .is("file_url", null);
      return;
    }
  } catch (error) {
    logError("LABEL_BUCKET_UPLOAD_FAILED", {
      organizationId,
      labelId: label.id,
      filePath: label.file_path,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
