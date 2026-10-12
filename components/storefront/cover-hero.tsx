"use client";

import { useEffect, useRef } from "react";
import { StoreImage } from "@/components/storefront/store-image";
import type { StoreSlide } from "@/components/storefront/store-types";
import { parseSafeCoverHref } from "@/modules/storefront/schema";
import { cn } from "@/lib/utils";

export function safeCtaHref(value?: string | null) {
  return parseSafeCoverHref(value ?? null) || null;
}

export function CoverHero({
  slide,
  preload = false,
  preview = "desktop",
  showGuides = false,
  className,
  onCtaClick,
  onVisible,
}: {
  slide: StoreSlide;
  preload?: boolean;
  preview?: "desktop" | "mobile";
  showGuides?: boolean;
  className?: string;
  onCtaClick?: () => void;
  onVisible?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const ctaHref = safeCtaHref(slide.ctaHref);
  const position = slide.textPosition ?? "left";
  const overlay = Math.min(80, Math.max(0, slide.overlayStrength ?? 40));
  const color = slide.textColor ?? "#ffffff";
  const focal = preview === "mobile" ? slide.mobileFocal : slide.desktopFocal;
  const objectPosition = focal ? `${focal.x}% ${focal.y}%` : "50% 50%";
  const src = preview === "mobile" && slide.mobileImageUrl ? slide.mobileImageUrl : slide.imageUrl;

  useEffect(() => {
    if (!onVisible || !ref.current) return;
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          onVisible();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);

  const align =
    position === "center" ? "items-center text-center" : position === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <article
      ref={ref}
      className={cn("relative h-full w-full min-w-full shrink-0 snap-center snap-always overflow-hidden", className)}
      aria-roledescription="slide"
      aria-label={slide.title || "Store cover"}
    >
      <picture>
        {slide.mobileImageUrl && preview !== "desktop" ? (
          <source media="(max-width: 767px)" srcSet={slide.mobileImageUrl} />
        ) : null}
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={slide.title || "Store cover"}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition }}
            loading={preload ? "eager" : "lazy"}
            fetchPriority={preload ? "high" : "auto"}
          />
        ) : (
          <StoreImage src={src} alt={slide.title || "Store cover"} sizes="100vw" preload={preload} objectPosition={objectPosition} />
        )}
      </picture>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            preview === "mobile"
              ? `linear-gradient(to top, rgb(0 0 0 / ${overlay / 100}) 0%, rgb(0 0 0 / ${overlay / 280}) 55%, transparent 100%)`
              : `linear-gradient(to right, rgb(0 0 0 / ${overlay / 100}) 0%, rgb(0 0 0 / ${overlay / 280}) 55%, transparent 100%)`,
        }}
      />
      <div
        className={cn(
          "absolute inset-x-4 bottom-7 flex max-w-[88%] flex-col sm:inset-x-5 sm:bottom-8 sm:max-w-[60%]",
          align,
          position === "center" && "inset-x-0 mx-auto",
          position === "right" && "sm:left-auto"
        )}
        style={{ color }}
      >
        {slide.offerBadge ? (
          <span className="mb-2 inline-flex rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-zinc-900">
            {slide.offerBadge}
          </span>
        ) : null}
        {slide.title ? <h2 className="text-lg font-bold leading-tight drop-shadow sm:text-3xl">{slide.title}</h2> : null}
        {slide.subtitle ? <p className="mt-1 line-clamp-2 text-[11px] text-current/90 drop-shadow sm:text-sm">{slide.subtitle}</p> : null}
        {slide.hook ? <p className="mt-1 text-[11px] font-medium sm:text-sm">{slide.hook}</p> : null}
        {slide.ctaLabel && ctaHref ? (
          <a
            href={ctaHref}
            className="pointer-events-auto mt-3 inline-flex min-h-10 items-center rounded-full bg-white px-4 py-2 text-xs font-bold text-zinc-900 shadow transition active:scale-95"
            onClick={onCtaClick}
          >
            {slide.ctaLabel}
          </a>
        ) : slide.ctaLabel ? (
          <span className="mt-3 inline-flex min-h-10 items-center rounded-full bg-white px-4 py-2 text-xs font-bold text-zinc-900 shadow">
            {slide.ctaLabel}
          </span>
        ) : null}
      </div>
      {showGuides ? (
        <div className="pointer-events-none absolute inset-6 rounded-lg border border-dashed border-white/50" aria-hidden />
      ) : null}
      <span className="sr-only" style={{ objectPosition }} />
    </article>
  );
}
