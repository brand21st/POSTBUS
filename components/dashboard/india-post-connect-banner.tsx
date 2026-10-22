"use client";

import Link from "next/link";
import { Plug } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { INDIA_POST_INTEGRATION_HREF } from "@/lib/dashboard/india-post-onboarding";
import { cn } from "@/lib/utils";

export function IndiaPostConnectBanner() {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <Plug className="size-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-950">⚠️ India Post Account Not Connected</p>
          <p className="text-xs leading-relaxed text-amber-800">
            Connect your India Post account to start booking shipments and generating labels.
          </p>
        </div>
      </div>
      <Link
        href={INDIA_POST_INTEGRATION_HREF}
        className={cn(buttonVariants({ variant: "primary", size: "sm" }), "shrink-0 self-start sm:self-auto")}
      >
        Complete Integration →
      </Link>
    </div>
  );
}
