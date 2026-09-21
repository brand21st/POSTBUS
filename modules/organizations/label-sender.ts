export type OrganizationIdentity = {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

export type PickupIdentity = {
  name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

export type OrganizationLabelSender = {
  name: string;
  phone: string | null;
  line1: string;
  line2: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
};

function firstText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function organizationLabelSender(
  org?: OrganizationIdentity | null,
  pickup?: PickupIdentity | null,
  shopName?: string | null
): OrganizationLabelSender {
  return {
    name: firstText(org?.name, pickup?.contact_name, pickup?.name, shopName) || "Merchant",
    phone: firstText(org?.phone, pickup?.phone) || null,
    line1: firstText(org?.line1, pickup?.line1) || "Registered pickup",
    line2: firstText(org?.line2, pickup?.line2),
    city: firstText(org?.city, pickup?.city) || null,
    state: firstText(org?.state, pickup?.state) || null,
    pincode: firstText(org?.pincode, pickup?.pincode) || null,
  };
}
