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
import { createOrderSchema } from "@/modules/orders/schema";
import { createManualOrder } from "@/modules/orders/service";

type PublicLinkRow = {
  id: string;
  organization_id: string;
  status: string;
  expires_at: string | null;
  public_workspace: string | null;
  public_code: string | null;
};

function invalidLink(): never {
  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "This link is not valid.");
}

export type PublicLinkRef =
  | { kind: "token"; token: string }
  | { kind: "path"; workspace: string; publicId?: string };

function assertToken(token: string) {
  if (!CUSTOMER_ORDER_LINK_TOKEN.test(normalizeCustomerOrderLinkToken(token))) invalidLink();
}

function assertPath(workspace: string, publicId?: string) {
  if (!CUSTOMER_ORDER_WORKSPACE.test(workspace)) invalidLink();
  if (publicId && !CUSTOMER_ORDER_PUBLIC_ID.test(publicId)) invalidLink();
}

const LINK_COLS = "id, organization_id, status, expires_at, public_workspace, public_code";

async function activeForOrg(supabase: SupabaseClient, organizationId: string) {
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_COLS)
    .eq("organization_id", organizationId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  return (data as PublicLinkRow | null) ?? null;
}

async function findByToken(supabase: SupabaseClient, token: string) {
  assertToken(token);
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_COLS)
    .eq("token_hash", hashSecret(normalizeCustomerOrderLinkToken(token)))
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const row = (data as PublicLinkRow | null) ?? null;
  if (!row) return null;
  if (row.status === "ACTIVE") return row;
  return activeForOrg(supabase, row.organization_id);
}

async function findByPath(supabase: SupabaseClient, workspace: string, publicId?: string) {
  assertPath(workspace, publicId);
  const { data, error } = await supabase
    .from("customer_order_links")
    .select(LINK_COLS)
    .eq("public_workspace", workspace)
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  if (data) {
    const row = data as PublicLinkRow;
    if (publicId && row.public_code && row.public_code !== publicId) return null;
    return row;
  }

  let builder = supabase.from("customer_order_links").select(LINK_COLS).eq("public_workspace", workspace);
  if (publicId) builder = builder.eq("public_code", publicId);
  const { data: legacy, error: legacyError } = await builder.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (legacyError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, legacyError.message);
  const row = (legacy as PublicLinkRow | null) ?? null;
  if (!row) return null;
  return activeForOrg(supabase, row.organization_id);
}

async function findLink(supabase: SupabaseClient, ref: PublicLinkRef) {
  return ref.kind === "path" ? findByPath(supabase, ref.workspace, ref.publicId) : findByToken(supabase, ref.token);
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
  if (row.status !== "ACTIVE") return { status: "DISABLED" };
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
  if (!row || row.status !== "ACTIVE") invalidLink();

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
  if (!row || row.status !== "ACTIVE") invalidLink();

  const phone = extractIndiaMobileDigits(input.phone);
  if (!phone) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter a valid 10-digit Indian mobile number.");
  }

  const orderInput = createOrderSchema.parse({
    source: "WHATSAPP",
    paymentStatus: "PENDING",
    customer: { name: input.customerName.trim(), phone },
    shippingAddress: {
      name: input.customerName.trim(),
      phone,
      line1: input.line1.trim(),
      line2: input.line2?.trim() || undefined,
      city: input.city.trim(),
      state: input.state.trim(),
      pincode: input.pincode.trim(),
      country: "IN",
    },
    billingSameAsShipping: true,
    lineItems: [{ title: "WhatsApp order", quantity: 1, unitPrice: 0 }],
  });

  const order = await createManualOrder(
    supabase,
    { organizationId: row.organization_id, userId: null },
    { ...orderInput, status: "IMPORTED" }
  );

  await supabase.from("audit_logs").insert({
    organization_id: row.organization_id,
    actor_id: null,
    action: "customer_order_link.submitted",
    entity_type: "order",
    entity_id: order.id,
    after: { collectionLinkId: row.id },
  });

  return { status: "SUBMITTED" as const };
}
