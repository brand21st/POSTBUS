import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { gstinStateCode, stateCodeFromName } from "@/modules/ai-accountant/gst";
import { saveInvoiceSettings, getInvoiceSettings } from "@/modules/invoices/settings";
import type { SellerScheme } from "@/modules/sales-invoices/tax";

export type SellerProfile = {
  scheme: SellerScheme;
  gstin: string;
  legalName: string;
  tradeName: string;
  pan: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
};

const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function validateSellerProfile(input: SellerProfile) {
  if (!["UNREGISTERED", "REGULAR", "COMPOSITION"].includes(input.scheme)) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Choose a GST registration type.");
  }
  if (input.scheme === "UNREGISTERED") return input;
  const gstin = input.gstin.trim().toUpperCase();
  if (!GSTIN.test(gstin)) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Enter the 15-character GSTIN.");
  if (input.pan.trim() && !PAN.test(input.pan.trim().toUpperCase())) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "PAN must be 10 characters.");
  }
  if (!input.legalName.trim() || !input.line1.trim() || !input.state.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Legal name, address, and state are required for a GST registration.");
  }
  const stateCode = gstin.slice(0, 2);
  return { ...input, gstin, stateCode, pan: input.pan.trim().toUpperCase() };
}

export async function loadSellerProfile(supabase: SupabaseClient, organizationId: string): Promise<SellerProfile> {
  const [{ data: registration }, { data: org }, settings] = await Promise.all([
    supabase
      .from("gst_registrations")
      .select("gstin, legal_name, trade_name, pan, address_line1, address_line2, city, state_code, pincode, phone, email, scheme")
      .eq("organization_id", organizationId)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("organizations").select("name, phone, line1, line2, city, state, pincode").eq("id", organizationId).maybeSingle(),
    getInvoiceSettings(supabase, organizationId),
  ]);
  const scheme = (registration?.scheme as SellerScheme | undefined) ?? "UNREGISTERED";
  const gstin = String(registration?.gstin ?? "");
  return {
    scheme: scheme === "REGULAR" || scheme === "COMPOSITION" || scheme === "UNREGISTERED" ? scheme : "UNREGISTERED",
    gstin,
    legalName: String(registration?.legal_name ?? org?.name ?? ""),
    tradeName: String(registration?.trade_name ?? org?.name ?? ""),
    pan: String(registration?.pan ?? ""),
    line1: String(registration?.address_line1 ?? org?.line1 ?? ""),
    line2: String(registration?.address_line2 ?? org?.line2 ?? ""),
    city: String(registration?.city ?? org?.city ?? ""),
    state: String(org?.state ?? ""),
    stateCode: String(registration?.state_code ?? gstinStateCode(gstin) ?? stateCodeFromName(org?.state) ?? ""),
    pincode: String(registration?.pincode ?? org?.pincode ?? ""),
    phone: String(registration?.phone ?? org?.phone ?? ""),
    email: String(registration?.email ?? settings.businessEmail ?? ""),
    website: settings.website ?? "",
  };
}

export async function saveSellerProfile(supabase: SupabaseClient, organizationId: string, input: SellerProfile) {
  const profile = validateSellerProfile(input);
  const stateCode = profile.scheme === "UNREGISTERED"
    ? profile.stateCode || stateCodeFromName(profile.state) || "00"
    : profile.gstin.slice(0, 2);
  const { data: existing } = await supabase
    .from("gst_registrations")
    .select("id")
    .eq("organization_id", organizationId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = {
    organization_id: organizationId,
    gstin: profile.scheme === "UNREGISTERED" ? null : profile.gstin,
    legal_name: profile.legalName.trim() || null,
    trade_name: profile.tradeName.trim() || null,
    pan: profile.pan.trim() || null,
    address_line1: profile.line1.trim() || null,
    address_line2: profile.line2.trim() || null,
    city: profile.city.trim() || null,
    state_code: stateCode,
    pincode: profile.pincode.trim() || null,
    phone: profile.phone.trim() || null,
    email: profile.email.trim() || null,
    scheme: profile.scheme,
  };
  const { error } = existing?.id
    ? await supabase.from("gst_registrations").update(row).eq("id", existing.id).eq("organization_id", organizationId)
    : await supabase.from("gst_registrations").insert(row);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const settings = await getInvoiceSettings(supabase, organizationId);
  await saveInvoiceSettings(supabase, organizationId, {
    appearance: settings.appearance,
    gstin: profile.scheme === "UNREGISTERED" ? null : profile.gstin,
    businessEmail: profile.email || settings.businessEmail,
    website: profile.website || settings.website,
  });
  return loadSellerProfile(supabase, organizationId);
}
