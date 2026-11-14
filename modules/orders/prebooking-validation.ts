import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { logError, logInfo } from "@/lib/logger";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { consumeAiCredit } from "@/modules/ai-credits/service";
import { isAiAddressCheckEnabled } from "@/modules/automation/service";
import { canonicalStateName } from "@/modules/ai-accountant/gst";
import { wrapIndiaPostAddressLines } from "@/modules/india-post/address-lines";
import { isIndiaPostAcceptedStatus } from "@/modules/india-post/booking-status";
import { indiaPostIsEligibleBookingOffice, type IndiaPostOffice } from "@/modules/india-post/endpoints";
import {
  applyAiAddressSuggestion,
  classifyStoredShippingAddress,
  pinOfficeStateConflict,
  formattingReviewOnly,
  shippingAddressBookingBlock,
  validationPatchFromClassification,
  type AddressIssue,
  type AddressValidationStatus,
  type NormalizedShopifyShipping,
  type StoredShippingFields,
} from "@/modules/shopify/shipping-contact";

const PIN_CACHE_MS = 10 * 60 * 1000;
const PRECHECK_LIMIT = 500;
const CHECK_CONCURRENCY = 3;
const HOUSE_TOKEN = /(house|flat|door|building|villa|apartment|\bapt\b|ward|plot|floor|room|വീട്|ഫ്ലാറ്റ്|வீடு|मकान|फ्लैट)/i;
const PREMISE_TOKEN =
  /(house|flat|door|building|villa|apartment|\bapt\b|ward|plot|floor|room|block|wing|tower|phase|sector|shop|unit|basement|gala|\bg\d+[a-z]?\b|\bf\d+[a-z]?\b|വീട്|ഫ്ലാറ്റ്|வீடு|मकान|फ्लैट)/i;
const LOCALITY_TOKEN =
  /\b(nagar|layout|colony|enclave|vihar|puram|pally|palli|street|road|\brd\b|town|village|gram|ganj|bagh|market|bazaar|chowk|cross|extension|extn|society|residency|kunj|peta|palya)\b/i;
const LANDMARK_TOKEN = /^(near|opp\.?|opposite|behind|beside|next to|landmark|adjacent|close to|nr\.?)\b/i;
const UNIT_CODE = /^(?:[a-z]\d{1,4}[a-z]?|\d{1,3}[a-z])$/i;
const HAS_NUMBER = /\d|\p{Nd}/u;

const pinOfficeCache = new Map<string, { at: number; offices: IndiaPostOffice[] }>();

export type PrebookingUiStatus =
  | "not_checked"
  | "ready"
  | "needs_review"
  | "fix_required"
  | "validation_unavailable";

export type PrebookingIssue = AddressIssue & {
  offices?: Array<{ officeId: string; name: string; city: string; state: string }>;
};

export type PrebookingOrderResult = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  source: string;
  status: PrebookingUiStatus;
  blocking: boolean;
  fingerprint: string;
  issues: PrebookingIssue[];
  address: {
    name: string;
    phone: string;
    line1: string;
    line2: string;
    line3: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  parcel: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  } | null;
  autoCorrected: boolean;
};

export type PrebookingCheckResult = {
  total: number;
  ready: number;
  fixRequired: number;
  needsReview: number;
  unavailable: number;
  orders: PrebookingOrderResult[];
};

type SearchPostOffices = (pincode: string) => Promise<IndiaPostOffice[]>;

function collapse(value?: string | null) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mapPool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await run(items[current]);
    }
  });
  return Promise.all(workers);
}

export function clearDestinationPinCache() {
  pinOfficeCache.clear();
}

export function addressValidationFingerprint(address: StoredShippingFields) {
  const phone = extractIndiaMobileDigits(address.phone) ?? collapse(address.phone);
  const parts = [
    address.name,
    phone,
    address.line1,
    address.line2,
    address.line3,
    address.city,
    address.state,
    address.pincode,
    address.country || "IN",
  ].map((value) => collapse(value).toLocaleLowerCase());
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function prebookingUiStatus(
  status?: string | null,
  fingerprint?: string | null,
  currentFingerprint?: string | null
): PrebookingUiStatus {
  const stored = String(status ?? "").toUpperCase();
  if (stored === "READY" && fingerprint && currentFingerprint && fingerprint !== currentFingerprint) return "not_checked";
  if (stored === "READY") return "ready";
  if (stored === "NEEDS_REVIEW") return "needs_review";
  if (stored === "INVALID") return "fix_required";
  if (stored === "VALIDATION_UNAVAILABLE") return "validation_unavailable";
  return "not_checked";
}

export function isIndiaPostAddressError(message: string) {
  return /\b(address|pincode|pin code|addressee|locality)\b/i.test(message) || /receiver (city|state|pin)/i.test(message);
}

function stalePinCityReview(errors: unknown) {
  if (!Array.isArray(errors)) return false;
  return errors.some((issue) => {
    if (!issue || typeof issue !== "object") return false;
    const row = issue as { code?: unknown; message?: unknown };
    return row.code === "pin_city_review" || /city does not match the post offices/i.test(String(row.message ?? ""));
  });
}

function officeChoices(offices: IndiaPostOffice[]) {
  return offices.slice(0, 8).map((office) => ({
    officeId: String(office.office_id ?? ""),
    name: collapse(office.office_name) || "Post office",
    city: collapse(office.city_name),
    state: collapse(office.state_name),
  }));
}

function distinctPlaceNames(values: string[]) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const text = collapse(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(text);
  }
  return names;
}

/**
 * The delivery-office city for this PIN, when every eligible office agrees.
 * City comes from city_name. A conflicting city or state is left unchanged.
 */
export function cityAlignedToPin(city: string, offices: IndiaPostOffice[]) {
  const eligible = offices.filter(
    (office) => indiaPostIsEligibleBookingOffice(office) && collapse(office.city_name)
  );
  if (!eligible.length) return null;
  const wanted = collapse(city).toLocaleLowerCase();
  if (wanted && eligible.some((office) => sameAddressText(office.city_name || "", city))) return null;
  const cities = distinctPlaceNames(eligible.map((office) => office.city_name || ""));
  const states = distinctPlaceNames(eligible.map((office) => office.state_name || ""));
  if (cities.length !== 1 || states.length > 1) return null;
  const nextCity = cities[0];
  if (!nextCity || sameAddressText(nextCity, city)) return null;
  return { city: nextCity, ...(states[0] ? { state: states[0] } : {}) };
}

/** Street lines still need the model. A clean or invalid address does not. */
export function addressLinesNeedAi(address: StoredShippingFields) {
  const classified = classifyStoredShippingAddress(address);
  if (classified.status === "INVALID") return false;
  const storedLengthBroken = [address.line1, address.line2, address.line3].some((line) => {
    const text = collapse(line);
    return text.length > 0 && (text.length < 3 || text.length > 80);
  });
  return storedLengthBroken || classified.needsAi || Boolean(packAddressForIndiaPostBooking(address));
}

/**
 * A PIN is valid when India Post lists at least one post office for it.
 * Office names often differ from the city the customer typed, so the city is not compared.
 */
export function assessDestinationOffices(state: string, _city: string, offices: IndiaPostOffice[]) {
  if (!offices.length) {
    return {
      status: "INVALID" as const,
      message: "This PIN code was not found by India Post. Check the PIN and try again.",
      offices: [] as ReturnType<typeof officeChoices>,
    };
  }
  const stated = offices.filter((office) => collapse(office.state_name));
  const stateOk = offices.filter((office) => !pinOfficeStateConflict(state, office.state_name));
  if (stated.length && !stateOk.length) {
    return {
      status: "INVALID" as const,
      message: "This PIN code does not belong to the selected state.",
      offices: officeChoices(offices),
    };
  }
  const pool = stateOk.length ? stateOk : offices;
  return { status: "VERIFIED" as const, message: "", offices: officeChoices(pool) };
}

function splitFragments(value: string) {
  return value
    .replace(/,(?=\S)/g, ", ")
    .replace(/[,;]{2,}/g, ",")
    .replace(/\s+/g, " ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sameAddressText(left: string, right: string) {
  return collapse(left).toLocaleLowerCase() === collapse(right).toLocaleLowerCase();
}

function fragmentKind(part: string): "premise" | "landmark" | "locality" | "other" {
  if (LANDMARK_TOKEN.test(part)) return "landmark";
  if (HOUSE_TOKEN.test(part) || PREMISE_TOKEN.test(part) || UNIT_CODE.test(part.replace(/\s/g, ""))) return "premise";
  if (LOCALITY_TOKEN.test(part)) return "locality";
  return "other";
}

function laterLinesHavePremise(address: StoredShippingFields) {
  return splitFragments([address.line2, address.line3].map(collapse).filter(Boolean).join(", ")).some(
    (part) => fragmentKind(part) === "premise"
  );
}

function tokensOf(value: string) {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function streetLines(address: Pick<StoredShippingFields, "line1" | "line2" | "line3">) {
  return [collapse(address.line1), collapse(address.line2), collapse(address.line3)];
}

/** Reorder street fragments so premises book on line 1 and localities on later lines. */
export function packAddressForIndiaPostBooking(address: StoredShippingFields) {
  const original = streetLines(address);
  const parts = splitFragments(original.filter(Boolean).join(", "));
  if (parts.length < 2) return null;
  const groups: Record<"premise" | "other" | "locality" | "landmark", string[]> = {
    premise: [],
    other: [],
    locality: [],
    landmark: [],
  };
  const kinds = parts.map(fragmentKind);
  for (let index = 0; index < parts.length; index += 1) groups[kinds[index]].push(parts[index]);
  if (!groups.premise.length) return null;
  let seenPlace = false;
  let premiseAfterPlace = false;
  for (const kind of kinds) {
    if (kind === "locality" || kind === "landmark") seenPlace = true;
    if (kind === "premise" && seenPlace) premiseAfterPlace = true;
  }
  const messyComma = /,(?=\S)/.test([address.line1, address.line2, address.line3].filter(Boolean).join(","));
  if (!premiseAfterPlace && !messyComma && !laterLinesHavePremise(address)) return null;
  const packed = [...groups.premise, ...groups.other, ...groups.locality, ...groups.landmark];
  if (packed.length !== parts.length) return null;
  const wrapped = wrapIndiaPostAddressLines(
    [...groups.premise, ...groups.other].join(", "),
    groups.locality.join(", "),
    groups.landmark.join(", ")
  );
  const next = [wrapped.line1, wrapped.line2 ?? "", wrapped.line3 ?? ""];
  if (next.every((line, index) => collapse(line) === original[index])) return null;
  const blob = next.join(" ").toLocaleLowerCase();
  if (tokensOf(original.join(" ")).some((token) => !blob.includes(token.toLocaleLowerCase()))) return null;
  return { line1: next[0], line2: next[1], line3: next[2] };
}

function workingAddress(address: StoredShippingFields, packed?: { line1: string; line2: string; line3: string } | null) {
  if (!packed) return address;
  return { ...address, line1: packed.line1, line2: packed.line2, line3: packed.line3 };
}

function cityStateUnchanged(from: { city?: string | null; state?: string | null }, to: { city: string; state: string }) {
  const cityOk = !collapse(from.city) || sameAddressText(from.city || "", to.city);
  const fromState = canonicalStateName(collapse(from.state)) || collapse(from.state);
  const toState = canonicalStateName(collapse(to.state)) || collapse(to.state);
  const stateOk = !fromState || sameAddressText(fromState, toState);
  return cityOk && stateOk;
}

/** Safe cleanup only: whitespace, empty commas, and repeated words already present. */
export function formattingSuggestion(address: StoredShippingFields) {
  const original = [address.line1, address.line2, address.line3].map(collapse);
  const raw = original.filter(Boolean).join(", ");
  const messy = /[,;]{2,}|[ \t]{2,}/.test([address.line1, address.line2, address.line3].join(","));
  const parts = splitFragments(raw);
  const seen = new Set<string>();
  const kept: string[] = [];
  let removed = false;
  for (const part of parts) {
    const words: string[] = [];
    const wordSeen = new Set<string>();
    for (const word of part.split(" ")) {
      const key = word.toLocaleLowerCase();
      if (!key) continue;
      if (wordSeen.has(key)) {
        removed = true;
        continue;
      }
      wordSeen.add(key);
      words.push(word);
    }
    const next = words.join(" ");
    const key = next.toLocaleLowerCase();
    if (!key || seen.has(key)) {
      removed = true;
      continue;
    }
    seen.add(key);
    kept.push(next);
  }
  if (!removed && !messy) return null;
  const wrapped = wrapIndiaPostAddressLines(kept.join(", "));
  const next = [wrapped.line1, wrapped.line2 ?? "", wrapped.line3 ?? ""];
  if (next.every((line, index) => collapse(line) === original[index])) return null;
  return {
    line1: wrapped.line1,
    line2: wrapped.line2 ?? "",
    line3: wrapped.line3 ?? "",
    reasons: [
      removed ? "Repeated locality or address line removed." : "",
      messy ? "Extra commas or spaces removed." : "",
    ].filter(Boolean),
  };
}

function missingHouse(address: StoredShippingFields) {
  const line1 = collapse(address.line1);
  if (!line1) return false;
  if (HAS_NUMBER.test(line1) || HOUSE_TOKEN.test(line1)) return false;
  const tokens = line1.split(" ").filter(Boolean);
  const city = collapse(address.city).toLocaleLowerCase();
  const state = collapse(address.state).toLocaleLowerCase();
  const samePlace = line1.toLocaleLowerCase() === city || line1.toLocaleLowerCase() === state;
  return tokens.length < 2 || samePlace;
}

export async function lookupDestinationOffices(search: SearchPostOffices, pincode: string) {
  const pin = pincode.replace(/\D/g, "").slice(0, 6);
  const cached = pinOfficeCache.get(pin);
  if (cached && Date.now() - cached.at < PIN_CACHE_MS) return { ok: true as const, offices: cached.offices };
  try {
    const offices = await search(pin);
    pinOfficeCache.set(pin, { at: Date.now(), offices });
    return { ok: true as const, offices };
  } catch {
    return { ok: false as const, offices: [] as IndiaPostOffice[] };
  }
}

function contactFromStored(address: StoredShippingFields): NormalizedShopifyShipping {
  const classified = classifyStoredShippingAddress(address);
  const line1 = collapse(address.line1);
  const line2 = collapse(address.line2);
  const line3 = collapse(address.line3);
  const city = collapse(address.city);
  const state = collapse(address.state);
  const pincode = collapse(address.pincode);
  return {
    name: collapse(address.name),
    nameSource: "shipping",
    phone: extractIndiaMobileDigits(address.phone) ?? "",
    originalPhone: collapse(address.original_phone || address.phone),
    phoneSource: "shipping",
    company: collapse(address.company_name),
    line1,
    line2,
    line3,
    city,
    state,
    pincode,
    country: collapse(address.country || "IN") || "IN",
    original: {
      name: collapse(address.name),
      first_name: "",
      last_name: "",
      phone: "",
      company: "",
      address1: line1,
      address2: [line2, line3].filter(Boolean).join(", "),
      city,
      province: state,
      zip: pincode,
      country: collapse(address.country || "IN") || "IN",
    },
    changes: [],
    issues: classified.issues,
    status: classified.status,
    reviewRequired: classified.status !== "READY",
    needsAi: classified.needsAi,
    readyForBooking: classified.status === "READY",
    source: "deterministic",
  };
}

export async function assessPrebookingAddress(
  address: StoredShippingFields,
  options?: {
    searchPostOffices?: SearchPostOffices;
    allowAi?: boolean;
    forceAi?: boolean;
    supabase?: SupabaseClient;
    organizationId?: string;
  }
) {
  const packed = packAddressForIndiaPostBooking(address);
  let current = workingAddress(address, packed);
  let autoCorrected = Boolean(packed);
  const formatting = formattingSuggestion(current);
  if (formatting) {
    current = { ...current, line1: formatting.line1, line2: formatting.line2, line3: formatting.line3 };
    autoCorrected = true;
  }
  const fitted = wrapIndiaPostAddressLines(current.line1, current.line2, current.line3, current.city);
  if (
    fitted.line1 !== collapse(current.line1) ||
    (fitted.line2 ?? "") !== collapse(current.line2) ||
    (fitted.line3 ?? "") !== collapse(current.line3)
  ) {
    current = { ...current, line1: fitted.line1, line2: fitted.line2 ?? "", line3: fitted.line3 ?? "" };
    autoCorrected = true;
  }
  const classified = classifyStoredShippingAddress(current);
  const issues: PrebookingIssue[] = classified.issues.map((issue) => ({ ...issue, field: issue.field || "address" }));
  let status: AddressValidationStatus = classified.status;
  if (status !== "INVALID" && missingHouse(current)) {
    status = "NEEDS_REVIEW";
    issues.push({
      code: "missing_house",
      field: "line1",
      message: "House or building details look missing from address line 1.",
      blocking: false,
    });
  }

  const pin = collapse(current.pincode);
  const pinReady = /^[1-9][0-9]{5}$/.test(pin);
  if (status !== "INVALID" && pinReady && options?.searchPostOffices) {
    const lookup = await lookupDestinationOffices(options.searchPostOffices, pin);
    if (!lookup.ok) {
      status = "VALIDATION_UNAVAILABLE";
      issues.push({
        code: "pin_unavailable",
        field: "pincode",
        message: "India Post PIN verification is temporarily unavailable. Retry the address check.",
        blocking: true,
      });
    } else {
      const offices = assessDestinationOffices(collapse(current.state), collapse(current.city), lookup.offices);
      if (offices.status === "INVALID") {
        status = "INVALID";
        issues.push({
          code: /not found/i.test(offices.message) ? "pin_not_found" : "pin_state_mismatch",
          field: "pincode",
          message: offices.message,
          blocking: true,
          offices: offices.offices,
        });
      } else {
        const aligned = cityAlignedToPin(collapse(current.city), lookup.offices);
        if (aligned) {
          current = { ...current, city: aligned.city, ...(aligned.state ? { state: aligned.state } : {}) };
          autoCorrected = true;
        }
      }
    }
  }

  let next = current;
  let source = "prebooking";
  const alreadyAi = String(address.address_normalization_source ?? "").toLowerCase() === "ai";
  const lineLengthBroken = [current.line1, current.line2, current.line3].some((line) => {
    const text = collapse(line);
    return text.length > 0 && (text.length < 3 || text.length > 80);
  });
  const wantAi =
    Boolean(options?.allowAi) &&
    status !== "INVALID" &&
    status !== "VALIDATION_UNAVAILABLE" &&
    (lineLengthBroken || classified.needsAi || (!autoCorrected && Boolean(formatting)));
  if (wantAi) {
    try {
      const { requestAiAddressSuggestion } = await import("@/modules/shopify/address-ai");
      const contact = contactFromStored(next);
      const suggestion = await requestAiAddressSuggestion(contact);
      const applied = suggestion ? applyAiAddressSuggestion(contact, suggestion) : null;
      if (applied) {
        const wrapped = wrapIndiaPostAddressLines(applied.line1, applied.line2, applied.line3, applied.city);
        const lines = { line1: wrapped.line1, line2: wrapped.line2 ?? "", line3: wrapped.line3 ?? "" };
        const changed =
          streetLines(lines).join("|") !== streetLines(contact).join("|") ||
          collapse(applied.city) !== collapse(contact.city) ||
          collapse(applied.state) !== collapse(contact.state);
        const pinSame = !contact.pincode || applied.pincode === contact.pincode;
        const safe =
          Boolean(suggestion) &&
          !suggestion?.needs_review &&
          applied.status !== "INVALID" &&
          pinSame &&
          cityStateUnchanged(contact, { city: applied.city, state: applied.state });
        if (safe && changed) {
          let credited = true;
          if (options?.supabase && options.organizationId) {
            const remaining = await consumeAiCredit(options.supabase, options.organizationId, {
              reason: "AI_ADDRESS_EXTRACTION",
              idempotencyKey: `prebooking-address:${options.organizationId}:${address.id || addressValidationFingerprint(address)}`,
            });
            credited = remaining != null;
          }
          if (credited) {
            next = { ...next, ...lines };
            source = "ai";
            autoCorrected = true;
          }
        } else if (changed || applied.status !== "READY" || suggestion?.needs_review) {
          status = status === "VALIDATION_UNAVAILABLE" ? status : "NEEDS_REVIEW";
          issues.push({
            code: "ai_formatting",
            field: "line1",
            message: suggestion?.warnings?.[0] || suggestion?.changes?.[0] || "AI suggested an address cleanup. Review it before booking.",
            blocking: false,
            suggestion: {
              line1: lines.line1,
              line2: lines.line2,
              line3: lines.line3,
              city: applied.city,
              state: applied.state,
              pincode: applied.pincode,
            },
          });
        } else {
          source = alreadyAi || applied.source === "ai" ? "ai" : source;
        }
      }
    } catch (error) {
      logInfo("prebooking.ai_skipped", { reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  if (autoCorrected) {
    issues.push({
      code: "address_auto_corrected",
      field: "line1",
      message: "Address lines were corrected for India Post booking.",
      blocking: false,
    });
  }

  return {
    status,
    issues,
    fingerprint: addressValidationFingerprint(next),
    address: next,
    autoCorrected,
    source,
  };
}

export async function refreshAddressPrebooking(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    address: StoredShippingFields;
    searchPostOffices?: SearchPostOffices;
    allowAi?: boolean;
    force?: boolean;
    forceAi?: boolean;
  }
) {
  const fingerprint = addressValidationFingerprint(input.address);
  const stored = String(input.address.address_validation_status ?? "").toUpperCase();
  const reusable = stored === "READY" || stored === "NEEDS_REVIEW" || stored === "INVALID";
  const packed = packAddressForIndiaPostBooking(input.address);
  const classified = classifyStoredShippingAddress(input.address);
  const alreadyAi = String(input.address.address_normalization_source ?? "").toLowerCase() === "ai";
  const linesNeedAi = addressLinesNeedAi(input.address);
  const wantsAi = Boolean(input.allowAi) && classified.status !== "INVALID" && (input.forceAi || linesNeedAi);
  if (
    !input.searchPostOffices &&
    !input.force &&
    !input.forceAi &&
    !linesNeedAi &&
    input.address.address_validation_fingerprint === fingerprint &&
    reusable &&
    !packed &&
    !(stored === "NEEDS_REVIEW" && formattingReviewOnly(input.address.address_validation_errors)) &&
    !stalePinCityReview(input.address.address_validation_errors) &&
    !(wantsAi && !alreadyAi)
  ) {
    return input.address;
  }
  const assessed = await assessPrebookingAddress(input.address, {
    searchPostOffices: input.searchPostOffices,
    allowAi: input.allowAi,
    forceAi: input.forceAi,
    supabase: supabase,
    organizationId: input.organizationId,
  });
  const linesChanged =
    collapse(assessed.address.line1) !== collapse(input.address.line1) ||
    collapse(assessed.address.line2) !== collapse(input.address.line2) ||
    collapse(assessed.address.line3) !== collapse(input.address.line3);
  const cityChanged = collapse(assessed.address.city) !== collapse(input.address.city);
  const stateChanged = collapse(assessed.address.state) !== collapse(input.address.state);
  const patch = {
    ...validationPatchFromClassification(assessed, assessed.source || "prebooking"),
    address_validation_fingerprint: assessed.fingerprint,
    ...(linesChanged
      ? {
          line1: assessed.address.line1,
          line2: assessed.address.line2 || null,
          line3: assessed.address.line3 || null,
        }
      : {}),
    ...(cityChanged ? { city: assessed.address.city } : {}),
    ...(stateChanged ? { state: assessed.address.state } : {}),
  };
  logInfo("prebooking.address_checked", {
    organizationId: input.organizationId,
    addressId: input.address.id ?? null,
    status: assessed.status,
    issueCodes: assessed.issues.map((issue) => issue.code),
  });
  if (input.address.id) {
    const { error } = await supabase
      .from("addresses")
      .update(patch)
      .eq("id", input.address.id)
      .eq("organization_id", input.organizationId);
    // The saved result is only a cache. A failed write (schema drift, brief outage) must not
    // block booking when the check itself just ran.
    if (error) {
      logError("prebooking.address_cache_write_failed", {
        organizationId: input.organizationId,
        addressId: input.address.id,
        code: error.code ?? null,
        message: error.message,
      });
    }
  }
  return {
    ...input.address,
    ...patch,
    address_validation_errors: assessed.issues,
    autoCorrected: assessed.autoCorrected,
  };
}

/** PostBus address review applies to store orders. Manual and other sources book as entered. */
export function commerceAddressReviewRequired(source?: string | null) {
  const value = String(source ?? "").trim().toUpperCase();
  return value === "SHOPIFY" || value === "WOOCOMMERCE";
}

export async function gateAddressForBooking(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    address: StoredShippingFields | null;
    searchPostOffices?: SearchPostOffices;
    allowAi?: boolean;
    orderSource?: string | null;
  }
) {
  if (!input.address) {
    return {
      ok: false as const,
      retryable: false,
      message: "Missing shipping address. Correct the shipping address before India Post booking.",
      address: input.address,
    };
  }
  const knownSource = String(input.orderSource ?? "").trim();
  if (knownSource && !commerceAddressReviewRequired(knownSource)) {
    return { ok: true as const, retryable: false, message: null, address: input.address };
  }
  const address = await refreshAddressPrebooking(supabase, {
    organizationId: input.organizationId,
    address: input.address,
    searchPostOffices: input.searchPostOffices,
    allowAi: input.allowAi ?? false,
  });
  const status = String(address.address_validation_status ?? "").toUpperCase();
  if (status === "VALIDATION_UNAVAILABLE") {
    return {
      ok: false as const,
      retryable: true,
      message: shippingAddressBookingBlock(address) || "India Post PIN verification is temporarily unavailable.",
      address,
    };
  }
  const block = shippingAddressBookingBlock(address);
  if (block) return { ok: false as const, retryable: false, message: block, address };
  return { ok: true as const, retryable: false, message: null, address };
}

export async function recordProviderAddressRejection(
  supabase: SupabaseClient,
  organizationId: string,
  addressId: string,
  message: string
) {
  const issue: PrebookingIssue = {
    code: "provider_address",
    field: "address",
    message,
    blocking: true,
  };
  const { error } = await supabase
    .from("addresses")
    .update({
      address_validation_status: "INVALID",
      address_review_required: true,
      address_validation_fingerprint: null,
      address_validation_errors: [issue],
      address_normalization_source: "india_post",
      address_normalized_at: new Date().toISOString(),
    })
    .eq("id", addressId)
    .eq("organization_id", organizationId);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
}

type PrebookingOrderRow = {
  id: string;
  order_number?: string | null;
  source?: string | null;
  customers?: { name?: string | null } | { name?: string | null }[] | null;
  shipping_address?: StoredShippingFields | null;
  shipments?: Array<{ status?: string | null; weight_grams?: number | null; length_cm?: number | null; width_cm?: number | null; height_cm?: number | null }> | null;
};

function customerNameOf(row: PrebookingOrderRow) {
  const customers = row.customers;
  if (Array.isArray(customers)) return collapse(customers[0]?.name);
  return collapse(customers?.name);
}

function addressView(address?: StoredShippingFields | null) {
  return {
    name: collapse(address?.name),
    phone: collapse(address?.phone),
    line1: collapse(address?.line1),
    line2: collapse(address?.line2),
    line3: collapse(address?.line3),
    city: collapse(address?.city),
    state: collapse(address?.state),
    pincode: collapse(address?.pincode),
    country: collapse(address?.country || "IN") || "IN",
  };
}

function parcelView(row: PrebookingOrderRow) {
  const shipment = row.shipments?.[0];
  if (!shipment) return null;
  return {
    weightGrams: Number(shipment.weight_grams) || 0,
    lengthCm: Number(shipment.length_cm) || 0,
    widthCm: Number(shipment.width_cm) || 0,
    heightCm: Number(shipment.height_cm) || 0,
  };
}

async function loadPrebookingOrders(supabase: SupabaseClient, organizationId: string, ids: string[]) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, source, customers(name), shipping_address:addresses!shipping_address_id(*), shipments(status, weight_grams, length_cm, width_cm, height_cm)"
    )
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const rows = (data ?? []) as PrebookingOrderRow[];
  if (rows.length !== ids.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "One or more orders were not found in this workspace.");
  }
  return rows;
}

function orderResult(row: PrebookingOrderRow, address: StoredShippingFields | null | undefined, extra: PrebookingIssue[] = []): PrebookingOrderResult {
  const reviewApplies = commerceAddressReviewRequired(row.source);
  const current = address ? addressValidationFingerprint(address) : "";
  const storedIssues =
    reviewApplies && Array.isArray(address?.address_validation_errors)
      ? (address.address_validation_errors as PrebookingIssue[])
      : [];
  const issues = [...storedIssues, ...extra].filter((issue) => issue && (issue.message || issue.code));
  const status = !reviewApplies
    ? extra.some((issue) => issue.blocking)
      ? "fix_required"
      : "ready"
    : extra.some((issue) => issue.code === "already_booked")
      ? "fix_required"
      : extra.some((issue) => issue.blocking)
        ? address && prebookingUiStatus(address.address_validation_status, address.address_validation_fingerprint, current) === "validation_unavailable"
          ? "validation_unavailable"
          : "fix_required"
        : prebookingUiStatus(address?.address_validation_status, address?.address_validation_fingerprint, current);
  return {
    orderId: row.id,
    orderNumber: String(row.order_number ?? ""),
    customerName: customerNameOf(row) || collapse(address?.name),
    source: String(row.source ?? ""),
    status,
    blocking: status !== "ready",
    fingerprint: String(address?.address_validation_fingerprint ?? current),
    issues,
    address: addressView(address),
    parcel: parcelView(row),
    autoCorrected:
      Boolean((address as { autoCorrected?: boolean } | null | undefined)?.autoCorrected) ||
      issues.some((issue) => issue.code === "address_auto_corrected"),
  };
}

export async function precheckOrders(
  supabase: SupabaseClient,
  ctx: TenantContext,
  orderIds: string[],
  options?: { allowAi?: boolean; forceAi?: boolean }
): Promise<PrebookingCheckResult> {
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select at least one order.");
  if (ids.length > PRECHECK_LIMIT) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Validate at most 500 orders at a time.");
  }
  const rows = await loadPrebookingOrders(supabase, ctx.organizationId, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const aiAddressCheck = await isAiAddressCheckEnabled(supabase, ctx.organizationId);
  const allowAi = (options?.allowAi ?? true) && aiAddressCheck;
  const forceAi = Boolean(options?.forceAi) && aiAddressCheck;

  let booking: { rows: Array<{ orderId?: string; valid: boolean; issues: Array<{ orderId?: string; field: string; error: string }> }>; issues: Array<{ orderId?: string; field: string; error: string }> } | null = null;
  let disconnected = false;
  try {
    const { validateOrdersForBooking } = await import("@/modules/india-post/bulk-booking");
    booking = await validateOrdersForBooking(supabase, ctx, ids, { forceAi });
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.INTEGRATION_NOT_CONNECTED) disconnected = true;
    else throw error;
  }

  if (disconnected) {
    await mapPool(rows, CHECK_CONCURRENCY, async (row) => {
      const shipments = row.shipments ?? [];
      if (shipments.some((item) => isIndiaPostAcceptedStatus(item.status))) return;
      if (!row.shipping_address) return;
      if (!commerceAddressReviewRequired(row.source)) return;
      row.shipping_address = await refreshAddressPrebooking(supabase, {
        organizationId: ctx.organizationId,
        address: row.shipping_address,
        searchPostOffices: async () => {
          throw new Error("India Post is not connected.");
        },
        allowAi,
        forceAi,
      });
    });
  } else {
    const refreshed = await loadPrebookingOrders(supabase, ctx.organizationId, ids);
    for (const row of refreshed) byId.set(row.id, row);
  }

  const orders = ids.map((id) => {
    const row = byId.get(id)!;
    const booked = (row.shipments ?? []).some((item) => isIndiaPostAcceptedStatus(item.status));
    if (booked) {
      return orderResult(row, row.shipping_address, [
        { code: "already_booked", field: "order", message: "This order is already booked.", blocking: true },
      ]);
    }
    const articleIssues = (booking?.issues ?? [])
      .filter((issue) => issue.orderId === id && issue.field !== "shipping_address")
      .map((issue) => ({
        code: "article",
        field: issue.field,
        message: issue.error,
        blocking: true,
      }));
    const rowValid = booking?.rows.find((item) => item.orderId === id)?.valid;
    const extra = rowValid ? [] : articleIssues;
    return orderResult(row, row.shipping_address, extra);
  });

  return {
    total: orders.length,
    ready: orders.filter((order) => order.status === "ready").length,
    fixRequired: orders.filter((order) => order.status === "fix_required").length,
    needsReview: orders.filter((order) => order.status === "needs_review").length,
    unavailable: orders.filter((order) => order.status === "validation_unavailable").length,
    orders,
  };
}
