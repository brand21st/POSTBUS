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

function firstStreet(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || /^registered\s*pickup$/i.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

export function organizationLabelSender(
  org?: OrganizationIdentity | null,
  pickup?: PickupIdentity | null,
  shopName?: string | null
): OrganizationLabelSender {
  const line1 = firstStreet(org?.line1, pickup?.line1, org?.line2, pickup?.line2) || "Registered pickup";
  return {
    name: firstText(org?.name, pickup?.contact_name, pickup?.name, shopName) || "Merchant",
    phone: firstText(org?.phone, pickup?.phone) || null,
    line1,
    line2: firstStreet(
      org?.line2 && org.line2.trim() !== line1 ? org.line2 : "",
      pickup?.line2 && pickup.line2.trim() !== line1 ? pickup.line2 : ""
    ),
    city: firstText(org?.city, pickup?.city) || null,
    state: firstText(org?.state, pickup?.state) || null,
    pincode: firstText(org?.pincode, pickup?.pincode) || null,
  };
}
