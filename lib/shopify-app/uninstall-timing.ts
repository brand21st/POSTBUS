export function isStaleUninstall(triggeredAt: string | null | undefined, installedAt: string | null | undefined) {
  if (!triggeredAt || !installedAt) return false;
  const triggered = Date.parse(triggeredAt);
  const installed = Date.parse(installedAt);
  return Number.isFinite(triggered) && Number.isFinite(installed) && triggered < installed;
}
