export type PrintAgentUpdateManifest = {
  version: string;
  url: string;
  signature: string;
  notes?: string;
  pubDate?: string;
};

function parseVersion(input: string): number[] {
  const cleaned = input.trim().replace(/^v/i, "");
  return cleaned.split(".").map((part) => {
    const match = /^(\d+)/.exec(part);
    return match ? Number.parseInt(match[1], 10) : 0;
  });
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

export function readPrintAgentUpdateManifest(): PrintAgentUpdateManifest | null {
  const version = process.env.PRINT_AGENT_UPDATE_VERSION?.trim();
  const url = process.env.PRINT_AGENT_UPDATE_URL?.trim();
  const signature = process.env.PRINT_AGENT_UPDATE_SIGNATURE?.trim();
  if (!version || !url || !signature) return null;
  if (!url.startsWith("https://")) return null;

  const notes = process.env.PRINT_AGENT_UPDATE_NOTES?.trim();
  const pubDate = process.env.PRINT_AGENT_UPDATE_PUB_DATE?.trim();

  return {
    version,
    url,
    signature,
    notes: notes || undefined,
    pubDate: pubDate || undefined,
  };
}

export function resolvePrintAgentUpdate(
  target: string,
  arch: string,
  currentVersion: string
): PrintAgentUpdateManifest | null {
  if (target !== "windows" || arch !== "x86_64") return null;

  const manifest = readPrintAgentUpdateManifest();
  if (!manifest) return null;
  if (!isVersionNewer(manifest.version, currentVersion)) return null;

  return manifest;
}
