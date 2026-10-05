export type VachatAddressFields = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

export function vachatSingleLine(value?: string | null, max = 200) {
  return (value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);
}

/** Amount text for a template that already prints the rupee sign. */
export function vachatAmountParam(value: unknown) {
  if (value == null || value === "") return "";
  const amount = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(amount)) return "";
  const fixed = amount.toFixed(2);
  return fixed.endsWith(".00") ? String(Math.trunc(amount)) : fixed;
}

export function vachatAddressParam(address?: VachatAddressFields | null) {
  if (!address) return "";
  return vachatSingleLine(
    [address.line1, address.line2, address.city, address.state, address.pincode]
      .map((part) => vachatSingleLine(part, 120))
      .filter(Boolean)
      .join(", "),
    240
  );
}

/** Template "Merchant Name" / shop_name both use the PostBus workspace name. */
export function vachatMerchantTemplateFields(workspaceName?: string | null) {
  const name = vachatSingleLine(workspaceName);
  if (!name) return {};
  return {
    merchant_name: name,
    shop_name: name,
  };
}
