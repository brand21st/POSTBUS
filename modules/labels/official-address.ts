export function officialAddressLines(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pin?: string | null;
  mobile?: string | null;
}) {
  const street = [input.line1, input.line2]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0 && !/^registered\s*pickup$/i.test(value));
  const locality = [input.city, input.state].map((value) => (value ?? "").trim()).filter(Boolean).join(", ");
  const pin = (input.pin ?? "").trim();
  const phone = input.mobile ? `Ph: ${input.mobile}` : "";
  return [...street, locality, pin ? `- ${pin}` : "", phone].filter(Boolean);
}
