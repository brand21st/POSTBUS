"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, Lock } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { helpNav, sidebarNav } from "@/lib/dashboard/nav";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { lockedFeatureForPath } from "@/modules/billing/entitlements";
import type { MeResponse } from "@/types/api";

export function Sidebar({
  me,
  collapsed,
  onCollapsedChange,
  onNavigate,
  className,
}: {
  me?: MeResponse | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const planName = me?.subscription?.planName ?? me?.subscription?.planCode ?? "Starter";
  const features = me?.subscription?.features ?? [];
  const trial = me?.subscription?.status === "TRIAL";
  const workspace = me?.organization?.name ?? "Workspace";
  const profileName = me?.user.fullName ?? me?.user.email ?? "Account";

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-card transition-[width] duration-200",
        collapsed ? "w-[76px]" : "w-[260px]",
        className
      )}
    >
      <div className={cn("flex h-16 items-center px-4", collapsed && "justify-center px-2")}>
        {collapsed ? (
          <Link href="/dashboard" aria-label="PostBus dashboard" className="font-semibold text-brand">
            PB
          </Link>
        ) : (
          <Logo href="/dashboard" className="h-8" />
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Dashboard">
        {sidebarNav.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          const lockedFeature = trial ? null : lockedFeatureForPath(item.href);
          const locked = Boolean(lockedFeature && !features.includes(lockedFeature));
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-rose-100 text-brand-dark"
                  : "text-muted hover:bg-surface-soft hover:text-foreground",
                locked && !active && "text-muted/70"
              )}
            >
              <Icon className={cn("size-4 shrink-0", locked && "blur-[0.5px]")} />
              <span className={cn(collapsed && "sr-only", locked && "blur-[1px]")}>{item.label}</span>
              {locked && !collapsed ? <Lock className="ml-auto size-3.5 shrink-0 text-muted" /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 px-3 pb-4">
        <Separator />
        <Link
          href={helpNav.href}
          prefetch={false}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-soft hover:text-foreground",
            collapsed && "justify-center px-0"
          )}
        >
          <helpNav.icon className="size-4 shrink-0" />
          <span className={cn(collapsed && "sr-only")}>{helpNav.label}</span>
        </Link>

        <div
          className={cn(
            "rounded-xl border border-border bg-surface px-3 py-3",
            collapsed && "px-2 text-center"
          )}
        >
          <p className={cn("text-[11px] font-medium uppercase tracking-wide text-muted", collapsed && "sr-only")}>
            Current plan
          </p>
          <div className={cn("mt-1 flex items-center gap-2", collapsed && "justify-center")}>
            <Badge variant="brand">{collapsed ? String(planName).slice(0, 1) : planName}</Badge>
          </div>
        </div>

        <Link
          href="/dashboard/settings"
          prefetch={false}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-soft",
            collapsed && "justify-center px-0"
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface-soft text-xs font-semibold text-ink">
            {initials(workspace)}
          </span>
          <span className={cn("min-w-0", collapsed && "sr-only")}>
            <span className="block truncate text-sm font-medium text-ink">{workspace}</span>
            <span className="block truncate text-xs text-muted">Workspace</span>
          </span>
        </Link>

        <Link
          href="/dashboard/settings"
          prefetch={false}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-soft",
            collapsed && "justify-center px-0"
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-brand-dark">
            {initials(profileName)}
          </span>
          <span className={cn("min-w-0", collapsed && "sr-only")}>
            <span className="block truncate text-sm font-medium text-ink">{profileName}</span>
            <span className="block truncate text-xs text-muted">{me?.user.email}</span>
          </span>
        </Link>

        {onCollapsedChange ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden w-full md:flex"
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <ChevronsLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
            <span className={cn(collapsed && "sr-only")}>Collapse</span>
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
