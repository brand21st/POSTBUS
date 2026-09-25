"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PlanLock({
  locked,
  feature,
  compact = false,
  children,
}: {
  locked: boolean;
  feature?: string | null;
  compact?: boolean;
  children: ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    <div className={cn("relative overflow-hidden", compact ? "rounded-2xl" : "min-h-[28rem] rounded-3xl")}>
      <div className="pointer-events-none select-none blur-[6px]">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/55 px-4 backdrop-blur-[2px]">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-[0_12px_40px_rgb(9_9_11/0.08)]">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Lock className="size-4" />
          </span>
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">Upgrade plan</h2>
          <p className="mt-1.5 text-sm text-muted">
            {feature ? `${feature} is not included on your current plan.` : "This feature is not included on your current plan."}
          </p>
          <Link href="/dashboard/billing" className={cn(buttonVariants({ size: compact ? "sm" : "default" }), "mt-4")}>
            Upgrade plan
          </Link>
        </div>
      </div>
    </div>
  );
}
