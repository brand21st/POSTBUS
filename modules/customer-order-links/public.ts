import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { hashSecret } from "@/lib/security/crypto";
import {
  CUSTOMER_ORDER_LINK_TOKEN,
  CUSTOMER_ORDER_PUBLIC_ID,
  CUSTOMER_ORDER_WORKSPACE,
  normalizeCustomerOrderLinkToken,
  type SubmitCustomerOrderLinkInput,
} from "@/modules/customer-order-links/schema";
import {
  indiaPostOfficeToApiRow,
  indiaPostOfficesForSelection,
} from "@/modules/india-post/endpoints";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import type { CustomerOrderLinkStatus } from "@/types/domain";

type PublicLinkRow = {
  id: string;
  organization_id: string;
  status: CustomerOrderLinkStatus;
  expires_at: string;
};

function invalidLink(): never {
  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This link is not valid.");
}

export type PublicLinkRef =
  | { kind: "token"; token: string }
  | { kind: "path"; workspace: string; publicId: string };

function assertToken(token: string) {
  if (!CUSTOMER_ORDER_LINK_TOKEN.test(normalizeCustomerOrderLinkToken(token))) invalidLink();
}

function assertPath(workspace: string, publicId: string) {
  if (!CUSTOMER_ORDER_WORKSPACE.test(workspace) || !CUSTOMER_ORDER_PUBLIC_ID.test(publicId)) invalidLink();
}

async function findByToken(supabase: SupabaseClient, token: string) {
  assertToken(token);
  const { data, error } = await supabase
    .from("customer_order_links")
    .select("id, organization_id, status, expires_at")
    .eq("token_hash", hashSecret(normalizeCustomerOrderLinkToken(token)))
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data as PublicLinkRow | null) ?? null;
}

async function findByPath(supabase: SupabaseClient, workspace: string, publicId: string) {
  assertPath(workspace, publicId);
  const { data, error } = await supabase
    .from("customer_order_links")
    .select("id, organization_id, status, expires_at")
    .eq("public_workspace", workspace)
    .eq("public_code", publicId)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data as PublicLinkRow | null) ?? null;
}

async function findLink(supabase: SupabaseClient, ref: PublicLinkRef) {
  return ref.kind === "path" ? findByPath(supabase, ref.workspace, ref.publicId) : findByToken(supabase, ref.token);
}

function expired(row: PublicLinkRow) {
  return new Date(row.expires_at).getTime() <= Date.now();
}

export type PublicLinkView = {
  status: "OPEN" | "SUBMITTED" | "EXPIRED" | "DISABLED";
  merchantName?: string | null;
};

async function merchantName(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

export async function getPublicCustomerOrderLink(
  supabase: SupabaseClient,
  ref: PublicLinkRef
): Promise<PublicLinkView> {
  const row = await findLink(supabase, ref);
  if (!row) invalidLink();

  if (row.status === "DISABLED") return { status: "DISABLED" };
  if (row.status === "SUBMITTED" || row.status === "CONFIRMED") return { status: "SUBMITTED" };
  if (expired(row) || row.status === "EXPIRED") return { status: "EXPIRED" };

  if (row.status === "CREATED") {
    await supabase
      .from("customer_order_links")
      .update({ status: "OPENED", opened_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "CREATED");
  }

  return {
    status: "OPEN",
    merchantName: await merchantName(supabase, row.organization_id),
  };
}

export type PublicPincodeOffice = {
  name: string;
  city: string;
  state: string;
};

export type PublicPincodeLookup = {
  pincode: string;
  offices: PublicPincodeOffice[];
};

export async function lookupPublicOrderLinkPincode(
  supabase: SupabaseClient,
  ref: PublicLinkRef,
  rawPincode: string
): Promise<PublicPincodeLookup> {
  const pincode = rawPincode.replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(pincode)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid 6-digit PIN code.");
  }

  const row = await findLink(supabase, ref);
  if (!row) invalidLink();
  if (row.status === "DISABLED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This link is no longer available.");
  }
  if (row.status === "SUBMITTED" || row.status === "CONFIRMED") {
    throw new AppError(ERROR_CODES.CONFLICT, "Your details have already been submitted.");
  }
  if (expired(row) || row.status === "EXPIRED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This link has expired.");
  }

  const { data } = await supabase
    .from("india_post_connections")
    .select("*")
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (!data?.encrypted_username || !data?.encrypted_password) {
    return { pincode, offices: [] };
  }

  try {
    const offices = await indiaPostFromRow(data).searchPostOffices(pincode);
    const selected = indiaPostOfficesForSelection(offices);
    const shown = selected.length ? selected : offices.filter((office) => office.office_name);
    return {
      pincode,
      offices: shown.map((office) => {
        const rowOffice = indiaPostOfficeToApiRow(office, pincode);
        return {
          name: rowOffice.name,
          city: rowOffice.city,
          state: rowOffice.state,
        };
      }),
    };
  } catch {
    return { pincode, offices: [] };
  }
}

export async function submitPublicCustomerOrderLink(
  supabase: SupabaseClient,
  ref: PublicLinkRef,
  input: SubmitCustomerOrderLinkInput
) {
  const row = await findLink(supabase, ref);
  if (!row) invalidLink();
  if (row.status === "DISABLED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This link is no longer available.");
  }
  if (row.status === "SUBMITTED" || row.status === "CONFIRMED") {
    throw new AppError(ERROR_CODES.CONFLICT, "Your details have already been submitted.");
  }
  if (expired(row) || row.status === "EXPIRED") {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "This link has expired.");
  }

  const phone = extractIndiaMobileDigits(input.phone);
  if (!phone) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid 10-digit Indian mobile number.");
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("customer_order_links")
    .update({
      status: "SUBMITTED",
      customer_name: input.customerName.trim(),
      phone,
      line1: input.line1.trim(),
      line2: input.line2?.trim() || null,
      city: input.city.trim(),
      state: input.state.trim(),
      pincode: input.pincode.trim(),
      submitted_at: now,
    })
    .eq("id", row.id)
    .in("status", ["CREATED", "OPENED"])
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();

  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (!data) {
    throw new AppError(ERROR_CODES.CONFLICT, "Your details have already been submitted.");
  }

  await supabase.from("audit_logs").insert({
    organization_id: row.organization_id,
    actor_id: null,
    action: "customer_order_link.submitted",
    entity_type: "customer_order_link",
    entity_id: row.id,
  });

  return { status: "SUBMITTED" as const };
}
