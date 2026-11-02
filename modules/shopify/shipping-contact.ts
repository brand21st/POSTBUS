import { canonicalStateName, stateCodeFromName } from "@/modules/india-post/indian-states";
import { wrapIndiaPostAddressLines } from "@/modules/india-post/address-lines";
import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";

/**
 * Shared Shopify recipient mapping.
 *
 * Name priority: shipping address name or shipping first/last, then the customer
 * account name, then billing. Account and billing names are flagged because the
 * buyer and the recipient are not assumed to be the same person.
 * Shopify customer displayName is intentionally unused.
 *
 * Phone priority: shipping address, order phone, customer phone, billing phone.
 * A non-shipping number is kept and flagged for review. Invalid digit strings are
 * not truncated and not replaced.
 *
 * PIN codes are kept only when they are exactly six digits. Missing values stay empty.
 */

export const INDIA_POST_ADDRESS_TOTAL_MAX = INDIA_POST_ADDRESS_LINE_MAX * 3;

export type PhoneSource = "shipping" | "order" | "customer" | "billing" | "missing";
export type NameSource = "shipping" | "customer" | "billing" | "missing";
export type AddressValidationStatus = "READY" | "NEEDS_REVIEW" | "INVALID";

export type AddressIssue = {
  code: string;
  message: string;
  blocking: boolean;
};

export type ShopifyAddressInput = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country?: string | null;
  country_code?: string | null;
  phone?: string | null;
};

export type ShopifyShippingSource = {
  shipping_address?: ShopifyAddressInput | null;
  billing_address?: ShopifyAddressInput | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    displayName?: string | null;
  } | null;
  phone?: string | null;
  email?: string | null;
};

export type OriginalShippingSnapshot = {
  name: string;
  first_name: string;
  last_name: string;
  phone: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
};

export type NormalizedShopifyShipping = {
  name: string;
  nameSource: NameSource;
  phone: string;
  originalPhone: string;
  phoneSource: PhoneSource;
  company: string;
  line1: string;
  line2: string;
  line3: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  original: OriginalShippingSnapshot;
  changes: string[];
  issues: AddressIssue[];
  status: AddressValidationStatus;
  reviewRequired: boolean;
  needsAi: boolean;
  readyForBooking: boolean;
  source: "deterministic" | "ai";
};

const LANDMARK = /^(near|opp\.?|opposite|behind|beside|next to|landmark|adjacent|close to|nr\.?)\b/i;

function collapse(value?: string | null) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEmailOrPhone(value: string) {
  if (value.includes("@")) return true;
  const digits = value.replace(/\D/g, "");
  const compact = value.replace(/[\s+().-]/g, "");
  return digits.length >= 8 && digits.length >= compact.length - 1;
}

function joinPersonName(first?: string | null, last?: string | null) {
  const given = collapse(first);
  const family = collapse(last);
  if (!given) return family;
  if (!family) return given;
  const givenKey = given.toLocaleLowerCase();
  const familyKey = family.toLocaleLowerCase();
  if (givenKey === familyKey || givenKey.endsWith(` ${familyKey}`)) return given;
  if (familyKey.endsWith(` ${givenKey}`)) return family;
  return `${given} ${family}`;
}

function dedupeRepeatedName(value: string) {
  const parts = collapse(value).split(" ").filter(Boolean);
  if (parts.length >= 2 && parts.length % 2 === 0) {
    const half = parts.length / 2;
    const left = parts.slice(0, half).join(" ");
    const right = parts.slice(half).join(" ");
    if (left.toLocaleLowerCase() === right.toLocaleLowerCase()) return left;
  }
  return parts.join(" ");
}

function personNameFromAddress(address?: ShopifyAddressInput | null) {
  if (!address) return "";
  const fromParts = joinPersonName(address.first_name, address.last_name);
  const fromName = dedupeRepeatedName(address.name ?? "");
  if (fromName && looksLikeEmailOrPhone(fromName)) return fromParts;
  if (fromParts && fromName) {
    const partsKey = fromParts.toLocaleLowerCase();
    const nameKey = fromName.toLocaleLowerCase();
    if (partsKey === nameKey || nameKey.includes(partsKey)) return fromParts.length >= fromName.length ? fromParts : fromName;
    if (partsKey.includes(nameKey)) return fromParts;
    return fromName;
  }
  return fromParts || fromName;
}

export function shopifyRecipientName(order: ShopifyShippingSource) {
  const shipping = personNameFromAddress(order.shipping_address);
  if (shipping) return { name: shipping, source: "shipping" as const };
  const customer = joinPersonName(order.customer?.first_name, order.customer?.last_name);
  if (customer && !looksLikeEmailOrPhone(customer)) return { name: customer, source: "customer" as const };
  const billing = personNameFromAddress(order.billing_address);
  if (billing) return { name: billing, source: "billing" as const };
  return { name: "", source: "missing" as const };
}

type PhoneChoice = { phone: string; original: string; source: PhoneSource };

function phoneChoice(value: string | null | undefined, source: PhoneSource): PhoneChoice | null {
  const original = collapse(value);
  if (!original) return null;
  const phone = extractIndiaMobileDigits(original);
  return { phone: phone ?? "", original, source };
}

export function shopifyRecipientPhone(order: ShopifyShippingSource): PhoneChoice {
  const choices = [
    phoneChoice(order.shipping_address?.phone, "shipping"),
    phoneChoice(order.phone, "order"),
    phoneChoice(order.customer?.phone, "customer"),
    phoneChoice(order.billing_address?.phone, "billing"),
  ].filter((choice): choice is PhoneChoice => Boolean(choice));
  const valid = choices.find((choice) => choice.phone);
  if (valid) return valid;
  if (choices[0]) return choices[0];
  return { phone: "", original: "", source: "missing" };
}

export function shopifyPostalCode(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 6) return digits;
  return "";
}

function fragmentsOf(value: string) {
  return value
    .replace(/\r\n|\r|\n/g, ", ")
    .replace(/[,;|/]+/g, ",")
    .split(",")
    .map((part) => collapse(part))
    .filter(Boolean);
}

function sameText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function isLandmark(value: string) {
  return LANDMARK.test(value);
}

function isPlaceFragment(value: string) {
  return /^[\p{L}][\p{L}\s.'-]{1,48}$/u.test(value) && !isLandmark(value);
}

function snapshot(address?: ShopifyAddressInput | null, name = ""): OriginalShippingSnapshot {
  return {
    name,
    first_name: collapse(address?.first_name),
    last_name: collapse(address?.last_name),
    phone: collapse(address?.phone),
    company: collapse(address?.company),
    address1: collapse(address?.address1),
    address2: collapse(address?.address2),
    city: collapse(address?.city),
    province: collapse(address?.province || address?.province_code),
    zip: collapse(address?.zip),
    country: collapse(address?.country_code || address?.country || "IN"),
  };
}

export function assessShopifyShippingFields(input: {
  name: string;
  nameSource: NameSource;
  phone: string;
  phoneSource: PhoneSource;
  originalPhone: string;
  line1: string;
  line2: string;
  line3: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  changes: string[];
}): { issues: AddressIssue[]; status: AddressValidationStatus; needsAi: boolean } {
  const issues: AddressIssue[] = [];
  const add = (code: string, message: string, blocking: boolean) => issues.push({ code, message, blocking });
  if (!input.name) add("missing_name", "Missing recipient name.", true);
  else if (input.nameSource !== "shipping") {
    add("name_not_recipient", "Recipient name was taken from the buyer account, not the shipping address.", false);
  }
  if (!input.originalPhone && !input.phone) add("missing_phone", "Missing mobile number.", true);
  else if (!input.phone) add("invalid_phone", "Mobile number is not a 10-digit Indian number starting with 6, 7, 8, or 9.", true);
  else if (input.phoneSource !== "shipping") {
    add("phone_not_recipient", "Mobile number may belong to the buyer rather than the shipping recipient.", false);
  }
  if (!input.line1) add("missing_line1", "Address line 1 is empty.", true);
  if (!input.city) add("missing_city", "City is missing.", true);
  if (!input.state) add("missing_state", "State is missing.", true);
  else if (!stateCodeFromName(input.state)) add("invalid_state", "State is not a recognized Indian state or union territory.", false);
  if (!input.pincode) add("missing_pincode", "PIN code is missing.", true);
  else if (!/^[1-9][0-9]{5}$/.test(input.pincode)) add("invalid_pincode", "PIN code must be exactly six digits.", true);
  const street = [input.line1, input.line2, input.line3].filter(Boolean);
  const tooLong = street.some((line) => line.length > INDIA_POST_ADDRESS_LINE_MAX) || street.join("").length > INDIA_POST_ADDRESS_TOTAL_MAX;
  if (tooLong) {
    add("address_too_long", "Address exceeds India Post line limits. Review it before booking.", false);
  }
  const country = input.country.toUpperCase();
  if (country && country !== "IN" && country !== "INDIA") {
    add("country_not_india", "Shipping country is not India.", true);
  }
  const blocking = issues.some((issue) => issue.blocking);
  const review = issues.some((issue) => !issue.blocking);
  const status: AddressValidationStatus = blocking ? "INVALID" : review ? "NEEDS_REVIEW" : "READY";
  const fragmentCount = fragmentsOf(street.join(", ")).length;
  const needsAi = tooLong || fragmentCount >= 8 || (status !== "READY" && fragmentCount >= 5);
  return { issues, status, needsAi };
}

export function normalizeShopifyShipping(order: ShopifyShippingSource): NormalizedShopifyShipping {
  const recipient = shopifyRecipientName(order);
  const phone = shopifyRecipientPhone(order);
  const shipping = order.shipping_address ?? {};
  const changes: string[] = [];
  const rawStreet = `${shipping.address1 ?? ""}\n${shipping.address2 ?? ""}`;
  if (/[,;]{2,}|[ \t]{2,}/.test(rawStreet)) changes.push("Removed redundant punctuation");

  let parts = fragmentsOf(rawStreet);
  const deduped: string[] = [];
  const seen = new Set<string>();
  let removedDuplicate = false;
  for (const part of parts) {
    const key = part.toLocaleLowerCase();
    if (seen.has(key)) {
      removedDuplicate = true;
      continue;
    }
    seen.add(key);
    deduped.push(part);
  }
  parts = deduped;
  if (removedDuplicate) changes.push("Removed duplicate address fragments");

  let pincode = shopifyPostalCode(shipping.zip);
  const pinIndex = parts.findIndex((part) => /^\d{6}$/.test(part.replace(/\s/g, "")));
  if (pinIndex >= 0) {
    const found = parts[pinIndex].replace(/\D/g, "");
    if (!pincode) {
      pincode = found;
      changes.push("Moved PIN code out of the street address");
    } else if (pincode !== found) {
      changes.push("Street address contains a different PIN code");
    }
    if (pincode === found) parts.splice(pinIndex, 1);
  }

  const stateInput = collapse(shipping.province || shipping.province_code);
  let state = canonicalStateName(stateInput) || stateInput;
  const stateIndex = parts.findIndex((part) => canonicalStateName(part));
  if (stateIndex >= 0) {
    const found = canonicalStateName(parts[stateIndex]) || parts[stateIndex];
    if (!state) {
      state = found;
      changes.push("Moved state out of the street address");
    }
    if (sameText(state, found) || canonicalStateName(state) === canonicalStateName(found)) {
      parts.splice(stateIndex, 1);
    }
  }
  if (state && canonicalStateName(state)) state = canonicalStateName(state) || state;

  let city = collapse(shipping.city);
  if (city && sameText(city, state)) city = "";
  parts = parts.filter((part) => {
    if (city && sameText(part, city)) return false;
    if (state && (sameText(part, state) || canonicalStateName(part) === canonicalStateName(state))) return false;
    if (pincode && part.replace(/\D/g, "") === pincode && /^\d{6}$/.test(part.replace(/\D/g, ""))) return false;
    return true;
  });

  if (!city) {
    const placeIndexes = parts
      .map((part, index) => (isPlaceFragment(part) ? index : -1))
      .filter((index) => index >= 0);
    const hasOtherContent = parts.some((part, index) => !placeIndexes.includes(index));
    if (placeIndexes.length === 1 && hasOtherContent) {
      city = parts[placeIndexes[0]];
      parts.splice(placeIndexes[0], 1);
      changes.push("Moved city out of the street address");
    }
  }

  const landmarkAt = parts.findIndex(isLandmark);
  const line1Parts = landmarkAt > 0 ? parts.slice(0, landmarkAt) : parts;
  const line2Parts = landmarkAt > 0 ? parts.slice(landmarkAt) : [];
  const wrapped = wrapIndiaPostAddressLines(line1Parts.join(", "), line2Parts.join(", "));
  const countryCode = collapse(shipping.country_code || shipping.country || "IN").toUpperCase() || "IN";
  const country = countryCode === "INDIA" ? "IN" : countryCode;

  const classified = assessShopifyShippingFields({
    name: recipient.name,
    nameSource: recipient.source,
    phone: phone.phone,
    phoneSource: phone.source,
    originalPhone: phone.original,
    line1: wrapped.line1,
    line2: wrapped.line2 ?? "",
    line3: wrapped.line3 ?? "",
    city,
    state,
    pincode,
    country,
    changes,
  });
  if (changes.includes("Street address contains a different PIN code")) {
    classified.issues.push({
      code: "pin_conflict",
      message: "The street address PIN code does not match the PIN code field.",
      blocking: false,
    });
    if (classified.status === "READY") classified.status = "NEEDS_REVIEW";
  }

  return {
    name: recipient.name,
    nameSource: recipient.source,
    phone: phone.phone,
    originalPhone: phone.original,
    phoneSource: phone.source,
    company: collapse(shipping.company),
    line1: wrapped.line1,
    line2: wrapped.line2 ?? "",
    line3: wrapped.line3 ?? "",
    city,
    state,
    pincode,
    country,
    original: snapshot(shipping, recipient.name),
    changes,
    issues: classified.issues,
    status: classified.status,
    reviewRequired: classified.status !== "READY",
    needsAi: classified.needsAi,
    readyForBooking: classified.status === "READY",
    source: "deterministic",
  };
}

const AI_ADDRESS_KEYS = ["address_line_1", "address_line_2", "address_line_3", "city", "state", "pincode"] as const;

export type AiAddressSuggestion = {
  address_line_1: string;
  address_line_2: string;
  address_line_3: string;
  city: string;
  state: string;
  pincode: string;
  changes: string[];
  warnings: string[];
  needs_review: boolean;
};

function originalBlob(contact: NormalizedShopifyShipping) {
  const source = contact.original;
  return [source.address1, source.address2, source.city, source.province, source.zip, contact.city, contact.state, contact.pincode]
    .join(" ")
    .toLocaleLowerCase();
}

function mentioned(blob: string, value: string) {
  const text = collapse(value).toLocaleLowerCase();
  if (!text) return true;
  return blob.includes(text);
}

/** Accept an AI suggestion only when it does not invent locality, PIN, or street tokens. */
export function applyAiAddressSuggestion(
  contact: NormalizedShopifyShipping,
  suggestion: AiAddressSuggestion
): NormalizedShopifyShipping | null {
  const blob = originalBlob(contact);
  const line1 = collapse(suggestion.address_line_1);
  const line2 = collapse(suggestion.address_line_2);
  const line3 = collapse(suggestion.address_line_3);
  const city = collapse(suggestion.city);
  const state = canonicalStateName(suggestion.state) || collapse(suggestion.state);
  const pincode = shopifyPostalCode(suggestion.pincode);
  if (contact.pincode && pincode !== contact.pincode) return null;
  if (!contact.pincode && suggestion.pincode.replace(/\D/g, "") && suggestion.pincode.replace(/\D/g, "") !== pincode) return null;
  if (pincode && !blob.includes(pincode)) return null;
  if (city && !mentioned(blob, city) && !sameText(city, contact.city)) return null;
  if (state && !mentioned(blob, state) && !sameText(state, contact.state) && canonicalStateName(contact.state) !== canonicalStateName(state)) {
    return null;
  }
  const invented = [line1, line2, line3]
    .join(" ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  if (invented.some((token) => !blob.includes(token.toLocaleLowerCase()))) return null;
  if (!line1) return null;

  const classified = assessShopifyShippingFields({
    name: contact.name,
    nameSource: contact.nameSource,
    phone: contact.phone,
    phoneSource: contact.phoneSource,
    originalPhone: contact.originalPhone,
    line1,
    line2,
    line3,
    city: city || contact.city,
    state: state || contact.state,
    pincode: pincode || contact.pincode,
    country: contact.country,
    changes: contact.changes,
  });
  for (const warning of suggestion.warnings) {
    classified.issues.push({ code: "ai_warning", message: warning, blocking: false });
  }
  if (suggestion.needs_review && classified.status === "READY") classified.status = "NEEDS_REVIEW";
  const changes = [...contact.changes, ...suggestion.changes.filter(Boolean)];
  return {
    ...contact,
    line1,
    line2,
    line3,
    city: city || contact.city,
    state: state || contact.state,
    pincode: pincode || contact.pincode,
    changes,
    issues: classified.issues,
    status: classified.status,
    reviewRequired: classified.status !== "READY",
    needsAi: false,
    readyForBooking: classified.status === "READY",
    source: "ai",
  };
}

export { AI_ADDRESS_KEYS };

export function addressStatusLabel(status?: string | null) {
  switch (String(status ?? "").toUpperCase()) {
    case "READY":
      return "Ready for Booking";
    case "NEEDS_REVIEW":
      return "Address Review Required";
    case "INVALID":
      return "Invalid Shipping Details";
    default:
      return "";
  }
}

export type StoredShippingFields = {
  id?: string | null;
  name?: string | null;
  company_name?: string | null;
  phone?: string | null;
  original_phone?: string | null;
  phone_source?: string | null;
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  original_shipping?: unknown;
  address_validation_status?: string | null;
  address_validation_errors?: unknown;
  address_manual_override?: boolean | null;
};

function issueMessages(errors: unknown) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map((issue) => {
      if (typeof issue === "string") return issue;
      if (issue && typeof issue === "object" && "message" in issue) return String((issue as { message?: unknown }).message ?? "");
      return "";
    })
    .filter(Boolean);
}

function bookingBlockMessage(status: string, errors: unknown) {
  const label = addressStatusLabel(status) || "Shipping address cannot be booked";
  const messages = issueMessages(errors);
  return messages.length ? `${label}: ${messages.join(" ")}` : `${label}. Correct the shipping address before India Post booking.`;
}

/** Classify the fields currently stored on an address row. Does not invent missing values. */
export function classifyStoredShippingAddress(address: StoredShippingFields) {
  const phoneSource = (["shipping", "order", "customer", "billing", "missing"] as const).includes(
    address.phone_source as PhoneSource
  )
    ? (address.phone_source as PhoneSource)
    : "shipping";
  return assessShopifyShippingFields({
    name: collapse(address.name),
    nameSource: "shipping",
    phone: extractIndiaMobileDigits(address.phone) ?? "",
    phoneSource,
    originalPhone: collapse(address.original_phone || address.phone),
    line1: collapse(address.line1),
    line2: collapse(address.line2),
    line3: collapse(address.line3),
    city: collapse(address.city),
    state: collapse(address.state),
    pincode: collapse(address.pincode),
    country: collapse(address.country || "IN"),
    changes: [],
  });
}

export function validationPatchFromClassification(
  classified: { issues: AddressIssue[]; status: AddressValidationStatus },
  source: string,
  extra: Record<string, unknown> = {}
) {
  return {
    address_validation_status: classified.status,
    address_review_required: classified.status !== "READY",
    address_validation_errors: classified.issues,
    address_normalization_source: source,
    address_normalized_at: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Fail closed: India Post live field checks always run.
 * Stored INVALID/NEEDS_REVIEW still blocks. Missing stored status (production
 * addresses schema) is classified from the latest saved fields.
 */
export function shippingAddressBookingBlock(address?: StoredShippingFields | null) {
  if (!address) {
    return "Missing shipping address. Correct the shipping address before India Post booking.";
  }
  const live = classifyStoredShippingAddress(address);
  if (live.status !== "READY") {
    return bookingBlockMessage(live.status, live.issues);
  }
  const stored = String(address.address_validation_status ?? "").toUpperCase();
  if (stored === "NEEDS_REVIEW" || stored === "INVALID") {
    return bookingBlockMessage(stored, address.address_validation_errors);
  }
  if (stored && stored !== "READY") {
    return "Shipping address validation is incomplete. Correct it before India Post booking.";
  }
  return null;
}

/** True when Shopify sync is allowed to replace this stored shipping address. */
export function shopifyMayRefreshStoredAddress(address?: StoredShippingFields | null) {
  if (!address) return true;
  if (address.address_manual_override === true) return false;
  if (address.address_manual_override == null) return false;
  if (address.original_shipping == null) return false;
  return true;
}

export function incomingShopifyShippingUnusable(contact: {
  line1: string;
  city: string;
  pincode: string;
  name: string;
  phone: string;
}) {
  return !collapse(contact.line1) && !collapse(contact.city) && !collapse(contact.pincode) && !collapse(contact.name) && !collapse(contact.phone);
}

/** Compare an entered state with an India Post pincode-search office state. Does not rewrite the address. */
export function pinOfficeStateConflict(enteredState?: string | null, officeState?: string | null) {
  const entered = collapse(enteredState);
  const office = collapse(officeState);
  if (!entered || !office) return false;
  const enteredCode = stateCodeFromName(entered);
  const officeCode = stateCodeFromName(office);
  if (enteredCode && officeCode) return enteredCode !== officeCode;
  return entered.toLocaleLowerCase() !== office.toLocaleLowerCase();
}

/** Columns written by Shopify/manual address persistence. Deploy 20261030143000 before this app. */
export const SHOPIFY_ADDRESS_WRITE_COLUMNS = [
  "line3",
  "original_phone",
  "phone_source",
  "original_shipping",
  "normalized_shipping",
  "address_validation_status",
  "address_normalization_source",
  "address_normalized_at",
  "address_review_required",
  "address_validation_errors",
  "address_manual_override",
] as const;

export function shopifyAddressPersistence(
  contact: NormalizedShopifyShipping,
  sourceUpdatedAt?: string | null,
  normalizedAt = new Date().toISOString(),
  options?: { manualOverride?: boolean | null }
) {
  return {
    name: contact.name || null,
    phone: contact.phone || null,
    original_phone: contact.originalPhone || null,
    phone_source: contact.phoneSource,
    line1: contact.line1,
    line2: contact.line2 || null,
    line3: contact.line3 || null,
    city: contact.city,
    state: contact.state,
    pincode: contact.pincode,
    country: contact.country || "IN",
    company_name: contact.company || null,
    state_code: stateCodeFromName(contact.state),
    original_shipping: contact.original,
    normalized_shipping: {
      name: contact.name,
      phone: contact.phone,
      phone_source: contact.phoneSource,
      line1: contact.line1,
      line2: contact.line2,
      line3: contact.line3,
      city: contact.city,
      state: contact.state,
      pincode: contact.pincode,
      changes: contact.changes,
      sourceUpdatedAt: sourceUpdatedAt || null,
    },
    address_validation_status: contact.status,
    address_normalization_source: contact.source,
    address_normalized_at: normalizedAt,
    address_review_required: contact.reviewRequired,
    address_validation_errors: contact.issues,
    address_manual_override: options?.manualOverride === undefined ? false : options.manualOverride,
  };
}
