export function indiaPostOfficeWritePayload(
  officeId: string,
  officeName?: string | null,
  pincode?: string | null
) {
  const digits = String(officeId ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits && digits.length !== 8) {
    return { error: "Office ID is 8 digits." as const };
  }
  let pin: string | null | undefined;
  if (pincode !== undefined) {
    const pinDigits = String(pincode ?? "").replace(/\D/g, "").slice(0, 6);
    if (pinDigits && pinDigits.length !== 6) {
      return { error: "Enter a valid 6-digit pincode." as const };
    }
    pin = pinDigits || null;
  }
  return {
    pickupDropoffOfficeId: digits || null,
    ...(officeName !== undefined ? { pickupDropoffOfficeName: officeName } : {}),
    ...(pin !== undefined ? { pickupDropoffOfficePincode: digits ? pin : null } : {}),
  };
}

export type IndiaPostPickupOfficeWrite = {
  pickupOfficeId: string | null;
  pickupOfficeName?: string | null;
  pickupOfficePincode?: string | null;
  pickupOfficeTypeCode?: string | null;
  pickupOfficeCity?: string | null;
  pickupOfficeState?: string | null;
};

function optionalText(value: string | null | undefined, max = 80) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

export function indiaPostPickupOfficeWritePayload(input: {
  officeId: string;
  officeName?: string | null;
  pincode?: string | null;
  officeTypeCode?: string | null;
  city?: string | null;
  state?: string | null;
}): IndiaPostPickupOfficeWrite | { error: string } {
  const digits = String(input.officeId ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits && digits.length !== 8) {
    return { error: "Please select a pickup office." };
  }
  let pincode: string | null | undefined;
  if (input.pincode !== undefined) {
    const pin = String(input.pincode ?? "").replace(/\D/g, "").slice(0, 6);
    if (pin && pin.length !== 6) {
      return { error: "Enter a valid 6-digit pincode." };
    }
    pincode = pin || null;
  }
  return {
    pickupOfficeId: digits || null,
    ...(input.officeName !== undefined ? { pickupOfficeName: optionalText(input.officeName) ?? null } : {}),
    ...(pincode !== undefined ? { pickupOfficePincode: digits ? pincode : null } : {}),
    ...(input.officeTypeCode !== undefined
      ? { pickupOfficeTypeCode: digits ? optionalText(input.officeTypeCode, 16) : null }
      : {}),
    ...(input.city !== undefined ? { pickupOfficeCity: digits ? optionalText(input.city) : null } : {}),
    ...(input.state !== undefined ? { pickupOfficeState: digits ? optionalText(input.state) : null } : {}),
  };
}
