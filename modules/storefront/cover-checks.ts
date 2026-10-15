export type CoverCheckInput = {
  title?: string | null;
  subtitle?: string | null;
  hook?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  offerBadge?: string | null;
  discountPercent?: number | null;
  overlayStrength?: number;
  textColor?: string;
  luminance?: number | null;
  mobileImageUrl?: string | null;
  imageUrl?: string | null;
  desktopFocal?: { x: number; y: number } | null;
  mobileFocal?: { x: number; y: number } | null;
};

export type CoverCheck = {
  id: string;
  ok: boolean;
  label: string;
  hint?: string;
};

function hexLuminance(hex: string) {
  const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff";
  const channels = [1, 3, 5].map((offset) => {
    const n = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function overlayBlend(imageLum: number, overlayStrength: number) {
  const overlay = 0;
  const alpha = Math.min(0.8, Math.max(0, overlayStrength) / 100);
  return overlay * alpha + imageLum * (1 - alpha);
}

function contrastRatio(a: number, b: number) {
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

function focalInSafeArea(focal?: { x: number; y: number } | null) {
  if (!focal) return true;
  return focal.x >= 20 && focal.x <= 80 && focal.y >= 20 && focal.y <= 80;
}

export function evaluateCoverChecks(input: CoverCheckInput): CoverCheck[] {
  const title = (input.title ?? "").trim();
  const ctaLabel = (input.ctaLabel ?? "").trim();
  const ctaHref = (input.ctaHref ?? "").trim();
  const overlay = input.overlayStrength ?? 40;
  const textLum = hexLuminance(input.textColor ?? "#ffffff");
  const imageLum = typeof input.luminance === "number" ? input.luminance : 0.45;
  const blended = overlayBlend(imageLum, overlay);
  const contrast = contrastRatio(textLum, blended);
  const discount = input.discountPercent ?? null;
  const badge = (input.offerBadge ?? "").trim();

  return [
    {
      id: "product",
      ok: Boolean(input.imageUrl),
      label: "Product clearly visible",
      hint: input.imageUrl ? undefined : "Upload a desktop cover image.",
    },
    {
      id: "headline",
      ok: title.length >= 4 && title.length <= 48,
      label: "Headline readable",
      hint:
        title.length > 48
          ? "Shorten the headline for mobile."
          : title.length < 4
            ? "Add a headline."
            : undefined,
    },
    {
      id: "cta",
      ok: Boolean(ctaLabel) && Boolean(ctaHref),
      label: "CTA visible",
      hint: ctaLabel && !ctaHref ? "Add a safe destination for the CTA." : ctaLabel ? undefined : "Add a CTA label.",
    },
    {
      id: "contrast",
      ok: contrast >= 3,
      label: "Headline contrast",
      hint: contrast >= 3 ? undefined : "Increase overlay strength or use a lighter text colour.",
    },
    {
      id: "mobile",
      ok: Boolean(input.mobileImageUrl),
      label: "Mobile layout checked",
      hint: input.mobileImageUrl ? undefined : "Add a mobile image so the desktop crop is not stretched.",
    },
    {
      id: "offer",
      ok: !badge || discount == null || /\d/.test(badge) === false || badge.includes(String(discount)),
      label: "Offer price verified",
      hint:
        badge && discount != null && /\d/.test(badge) && !badge.includes(String(discount))
          ? "Offer badge does not match the discount field."
          : undefined,
    },
    {
      id: "safe",
      ok: focalInSafeArea(input.desktopFocal) && focalInSafeArea(input.mobileFocal),
      label: "Brand identity maintained",
      hint: focalInSafeArea(input.desktopFocal) && focalInSafeArea(input.mobileFocal)
        ? undefined
        : "Move the focal point toward the centre so the product stays in the safe area.",
    },
  ];
}
