import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HERO_TRUST_POINTS } from "./types";

export function HeroCTA({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          href={siteConfig.getStartedUrl}
          className={cn(
            buttonVariants({ variant: "primary", size: "xl" }),
            "group w-full rounded-full px-8 text-base font-bold tracking-wide shadow-lg shadow-brand/25 transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-brand/35 active:scale-[0.99] sm:w-auto"
          )}
        >
          <span>Start Free Trial</span>
          <ArrowRight className="size-4.5 transition-transform group-hover:translate-x-1" />
        </Link>
        <Link
          href="/#how-it-works"
          className={cn(
            buttonVariants({ variant: "secondary", size: "xl" }),
            "w-full rounded-full px-8 text-base font-semibold sm:w-auto"
          )}
        >
          See How It Works
        </Link>
      </div>

      <ul className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
        {HERO_TRUST_POINTS.map((item) => (
          <li
            key={item}
            className="inline-flex items-center gap-2 text-xs font-medium text-zinc-600 sm:text-[13px]"
          >
            <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="size-3 stroke-[2.5]" aria-hidden="true" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
