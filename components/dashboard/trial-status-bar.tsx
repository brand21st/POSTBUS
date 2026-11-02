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
      <div className="flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-3">
        <p className="min-w-0 text-xs font-medium leading-relaxed sm:text-sm">
          <span className="font-semibold">{title}.</span> {message}
        </p>
        <Link
          href={ctaHref}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: ended ? "secondary" : "primary", size: "xs" }),
            ended && "shrink-0 border-white/40 bg-white/10 text-white hover:bg-white/20"
          )}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
