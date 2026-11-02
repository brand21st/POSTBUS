export const MAX_ACTIVE_COVERS = 8;

export type CoverRecord = {
  id: string;
  name: string | null;
  imageUrl: string;
  imagePath: string;
  mobileImageUrl: string | null;
  mobileImagePath: string | null;
  title: string | null;
  subtitle: string | null;
  hook: string | null;
  description: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  offerBadge: string | null;
  discountPercent: number | null;
  coverType: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  textPosition: "left" | "center" | "right";
  overlayStrength: number;
  textColor: string;
  desktopFocal: { x: number; y: number };
  mobileFocal: { x: number; y: number };
  luminance: number | null;
  startsAt: string | null;
  endsAt: string | null;
  sourceAssetId: string | null;
  aiAssetId: string | null;
  festival: string | null;
  preset: string | null;
  sortOrder: number;
  enabled: boolean;
};

export function coverLifecycle(cover: Pick<CoverRecord, "status" | "enabled" | "startsAt" | "endsAt">, now = new Date()) {
  if (cover.status === "ARCHIVED") return "archived";
  if (cover.status === "DRAFT" || !cover.enabled) return "draft";
  if (cover.startsAt && new Date(cover.startsAt) > now) return "scheduled";
  if (cover.endsAt && new Date(cover.endsAt) <= now) return "expired";
  return "live";
}

export function eligibleCovers(covers: CoverRecord[], now = new Date()) {
  return covers
    .filter((cover) => coverLifecycle(cover, now) === "live" && Boolean(cover.imageUrl))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
