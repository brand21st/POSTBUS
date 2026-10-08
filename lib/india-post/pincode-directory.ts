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

export function indiaPostDirectoryOfficesFromResponse(json: unknown): IndiaPostDirectoryOffice[] {
  const payload = Array.isArray(json) ? (json as PostalPincodeResponse)[0] : null;
  if (!payload || payload.Status !== "Success" || !Array.isArray(payload.PostOffice)) return [];
  const seen = new Set<string>();
  const offices: IndiaPostDirectoryOffice[] = [];
  for (const row of payload.PostOffice) {
    const office = officeFromPostal(row ?? {});
    if (!office) continue;
    const key = `${office.name}|${office.city}|${office.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offices.push(office);
  }
  return offices;
}

export async function lookupIndiaPostPincodeDirectory(
  rawPincode: string,
  fetchImpl: typeof fetch = fetch
): Promise<IndiaPostDirectoryLookup> {
  const pincode = rawPincode.replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) {
    return { pincode, offices: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${DIRECTORY_URL}${pincode}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) return { pincode, offices: [] };
    return { pincode, offices: indiaPostDirectoryOfficesFromResponse(json) };
  } catch {
    return { pincode, offices: [] };
  } finally {
    clearTimeout(timer);
  }
}
