export type IndiaPostDirectoryOffice = {
  name: string;
  city: string;
  state: string;
};

export type IndiaPostDirectoryLookup = {
  pincode: string;
  offices: IndiaPostDirectoryOffice[];
};

const DIRECTORY_URL = "https://api.postalpincode.in/pincode/";
const FALLBACK_DIRECTORY_URL = "https://api.pincodeapi.in/api/v1/pincode/";
const LOOKUP_TIMEOUT_MS = 8_000;

type PostalOffice = {
  Name?: string;
  District?: string;
  Block?: string;
  Division?: string;
  State?: string;
};

type PostalPincodeResponse = Array<{
  Status?: string;
  PostOffice?: PostalOffice[] | null;
}>;

type FallbackOffice = {
  office_name?: string;
  district?: string;
  state?: string;
  office_type?: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function officeFromPostal(row: PostalOffice): IndiaPostDirectoryOffice | null {
  const name = text(row.Name);
  const city = text(row.District) || text(row.Block) || text(row.Division) || name;
  const state = text(row.State);
  if (!name && !city) return null;
  return { name: name || city, city, state };
}

function uniqueOffices(offices: IndiaPostDirectoryOffice[]) {
  const seen = new Set<string>();
  const unique: IndiaPostDirectoryOffice[] = [];
  for (const office of offices) {
    const key = `${office.name}|${office.city}|${office.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(office);
  }
  return unique;
}

function officeRank(office: IndiaPostDirectoryOffice, officeType = "") {
  const type = officeType.toUpperCase();
  const name = office.name.toUpperCase();
  if (type === "HO" || /\bG\.?P\.?O\.?\b/.test(name) || name.endsWith(" HO")) return 0;
  if (type === "PO" || type === "SO" || name.endsWith(" SO") || name.endsWith(" S.O")) return 1;
  return 2;
}

export function indiaPostDirectoryOfficesFromResponse(json: unknown): IndiaPostDirectoryOffice[] {
  const payload = Array.isArray(json) ? (json as PostalPincodeResponse)[0] : null;
  if (!payload || payload.Status !== "Success" || !Array.isArray(payload.PostOffice)) return [];
  const offices: IndiaPostDirectoryOffice[] = [];
  for (const row of payload.PostOffice) {
    const office = officeFromPostal(row ?? {});
    if (office) offices.push(office);
  }
  return uniqueOffices(offices);
}

export function indiaPostDirectoryOfficesFromFallbackResponse(json: unknown): IndiaPostDirectoryOffice[] {
  if (!json || typeof json !== "object") return [];
  const payload = json as { success?: boolean; data?: { post_offices?: FallbackOffice[] | null } };
  if (payload.success === false || !Array.isArray(payload.data?.post_offices)) return [];
  const ranked: Array<{ office: IndiaPostDirectoryOffice; rank: number }> = [];
  for (const row of payload.data.post_offices) {
    const name = text(row?.office_name);
    const city = text(row?.district) || name;
    const state = text(row?.state);
    if (!name && !city) continue;
    const office = { name: name || city, city, state };
    ranked.push({ office, rank: officeRank(office, text(row?.office_type)) });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return uniqueOffices(ranked.map((item) => item.office));
}

async function fetchDirectoryJson(url: string, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupIndiaPostPincodeDirectory(
  rawPincode: string,
  fetchImpl: typeof fetch = fetch
): Promise<IndiaPostDirectoryLookup> {
  const pincode = rawPincode.replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) {
    return { pincode, offices: [] };
  }

  const primary = await fetchDirectoryJson(`${DIRECTORY_URL}${pincode}`, fetchImpl);
  const offices = indiaPostDirectoryOfficesFromResponse(primary);
  if (offices.length) return { pincode, offices };

  const fallback = await fetchDirectoryJson(`${FALLBACK_DIRECTORY_URL}${pincode}`, fetchImpl);
  return { pincode, offices: indiaPostDirectoryOfficesFromFallbackResponse(fallback) };
}
