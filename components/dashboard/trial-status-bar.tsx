"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TrialStatusBar({
  title,
  message,
  ctaLabel,
  ctaHref,
  ended,
}: {
  title: string;
  message: string;
  ctaLabel: string;
  ctaHref: string;
  ended: boolean;
}) {
  return (
    <div
      role="region"
      aria-label={title}
      className={cn(
        "border-b px-4 py-2 lg:px-6",
        ended ? "border-brand-dark bg-brand text-white" : "border-brand/20 bg-brand/10 text-ink"
      )}
    >
      <div className="flex items-center justify-between gap-3 text-left sm:justify-center sm:text-center">
        <p className="min-w-0 text-xs font-medium leading-snug sm:text-sm sm:leading-relaxed">
          <span className="font-semibold">{title}.</span> {message}
        </p>
        <Link
          href={ctaHref}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: ended ? "secondary" : "primary", size: "xs" }),
            "shrink-0",
            ended && "border-white/40 bg-white/10 text-white hover:bg-white/20"
          )}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
