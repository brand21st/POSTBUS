"use client";

import { useState, type ComponentType, type FocusEvent, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, Lock } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { WhatsappIcon } from "@/components/layout/whatsapp-support-button";
import { Badge } from "@/components/ui/badge";
import { aiAccountantNav, helpNav, isNavItemActive, sidebarNav, tutorialsNav } from "@/lib/dashboard/nav";
import { useSupportUnread } from "@/lib/hooks/use-support-unread";
import { initials } from "@/lib/format";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { lockedFeatureForPath } from "@/modules/billing/entitlements";
import { multiUpPrintEnabled } from "@/modules/labels/multi-up/flag";
import type { MeResponse } from "@/types/api";

// Section headings shown above these items; presentation only, nav.ts stays the source of routes.
const NAV_SECTIONS: Record<string, string> = {
  "/dashboard/orders": "Shipping",
  "/dashboard/automation": "Workspace",
};

type Tip = { label: string; top: number; left: number };

const itemBase =
  "group/nav relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-card";
const itemIdle = "text-muted hover:bg-surface-soft hover:text-foreground";
const itemActive = "bg-rose-50 text-brand-dark dark:bg-brand/15 dark:text-rose-200";

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
  const trial = Boolean(me?.subscription?.trial);
  const workspace = me?.organization?.name ?? "Workspace";
  const profileName = me?.user.fullName ?? me?.user.email ?? "Account";
  const supportUnread = useSupportUnread();
  const whatsappHref = `https://wa.me/${siteConfig.supportWhatsapp}?text=${encodeURIComponent(
    `Hi PostBus support, I need help with my workspace "${workspace}".`
  )}`;
  const [tip, setTip] = useState<Tip | null>(null);

  // Collapsed rail labels render as a fixed tooltip so the scrolling nav cannot clip them.
  const tipHandlers = (label: string) =>
    collapsed
      ? {
          onMouseEnter: (event: MouseEvent<HTMLElement>) => showTip(label, event.currentTarget),
          onMouseLeave: () => setTip(null),
          onFocus: (event: FocusEvent<HTMLElement>) => showTip(label, event.currentTarget),
          onBlur: () => setTip(null),
        }
      : {};

  function showTip(label: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  }

  function navLink({
    href,
    label,
    icon: Icon,
    tour,
    active,
    locked,
    badge,
    iconClassName,
  }: {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    tour?: string;
    active: boolean;
    locked?: boolean;
    badge?: number;
    iconClassName?: string;
  }) {
    return (
      <Link
        href={href}
        prefetch={false}
        data-tour={tour}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          setTip(null);
          onNavigate?.();
        }}
        {...tipHandlers(locked ? `${label} (upgrade to unlock)` : label)}
        className={cn(
          itemBase,
          collapsed && "w-10 justify-center px-0",
          active ? itemActive : itemIdle,
          locked && !active && "text-muted/70"
        )}
      >
        {active ? (
          <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />
        ) : null}
        <Icon className={cn("size-4 shrink-0", locked && "blur-[0.5px]", iconClassName)} />
        <span className={cn("truncate", collapsed && "sr-only", locked && "blur-[1px]")}>{label}</span>
        {badge && badge > 0 ? (
          collapsed ? (
            <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-brand" />
          ) : (
            <Badge variant="brand" className="ml-auto h-5 min-w-5 px-1.5">
              {badge > 99 ? "99+" : badge}
            </Badge>
          )
        ) : null}
        {locked && !collapsed ? <Lock aria-hidden className="ml-auto size-3.5 shrink-0 text-muted" /> : null}
      </Link>
    );
  }

  const items = sidebarNav.flatMap((item) => {
    const extra =
      item.href === "/dashboard/integrations" &&
      (me?.addons ?? []).some(
        (addon) =>
          addon.slug === "ai-accountant" &&
          (addon.accessMode === "FULL" || addon.accessMode === "READ_ONLY")
      )
        ? [aiAccountantNav]
        : [];
    return [item, ...extra];
  });

  return (
    <aside
      data-tour="nav"
      data-collapsed={collapsed ? "true" : undefined}
      className={cn(
        "sticky top-0 flex h-svh shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-[232px]",
        className
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b border-border px-3",
          collapsed && "justify-center px-2"
        )}
      >
        {collapsed ? (
          <Link
            href="/dashboard"
            prefetch={false}
            aria-label="PostBus dashboard"
            className="flex size-9 items-center justify-center rounded-lg bg-brand text-xs font-bold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            PB
          </Link>
        ) : (
          <>
            <Logo href="/dashboard" className="[&_img]:h-8 [&_img]:sm:h-8" />
            {onCollapsedChange ? (
              <button
                type="button"
                onClick={() => onCollapsedChange(true)}
                aria-label="Collapse sidebar"
                aria-expanded
                title="Collapse sidebar"
                className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ChevronsLeft aria-hidden className="size-4" />
              </button>
            ) : null}
          </>
        )}
      </div>

      <nav
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-1.5 [scrollbar-width:thin]",
          collapsed && "flex flex-col items-center px-2"
        )}
        aria-label="Dashboard"
        onScroll={() => setTip(null)}
      >
        <ul className={cn(collapsed && "flex flex-col items-center")}>
          {items.map((item) => {
            const active = isNavItemActive(item.href, pathname);
            const lockedFeature = trial ? null : lockedFeatureForPath(item.href);
            const locked = Boolean(lockedFeature && !features.includes(lockedFeature));
            const children = (item.children ?? []).filter((child) => {
              if (child.href === "/dashboard/labels/multi-print") return multiUpPrintEnabled();
              return true;
            });
            const showChildren = !collapsed && children.length > 0 && active;
            const section = NAV_SECTIONS[item.href];
            return (
              <li key={item.href} className={cn(collapsed && "flex flex-col items-center")}>
                {section ? (
                  collapsed ? (
                    <span aria-hidden className="mx-auto my-1 block h-px w-6 bg-border" />
                  ) : (
                    <p className="px-2.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase leading-4 tracking-wider text-muted/80">
                      {section}
                    </p>
                  )
                ) : null}
                {navLink({
                  href: item.href,
                  label: item.label,
                  icon: item.icon,
                  tour: item.tour,
                  active,
                  locked,
                  badge: item.href === "/dashboard/support" ? supportUnread.count : undefined,
                })}
                {showChildren ? (
                  <ul className="my-0.5 ml-[18px] space-y-0.5 border-l border-border pl-2">
                    {children.map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                      const childLockedFeature = trial ? null : lockedFeatureForPath(child.href);
                      const childLocked = Boolean(childLockedFeature && !features.includes(childLockedFeature));
                      return (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            prefetch={false}
                            onClick={onNavigate}
                            aria-current={childActive ? "page" : undefined}
                            className={cn(
                              "flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                              childActive ? itemActive : itemIdle,
                              childLocked && !childActive && "text-muted/70"
                            )}
                          >
                            <span className={cn("truncate", childLocked && "blur-[1px]")}>{child.label}</span>
                            {childLocked ? <Lock aria-hidden className="ml-auto size-3.5 shrink-0 text-muted" /> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={cn(
          "shrink-0 space-y-0.5 border-t border-border px-2.5 py-1.5",
          collapsed && "flex flex-col items-center px-2"
        )}
      >
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setTip(null)}
          {...tipHandlers("WhatsApp support · 24x7")}
          aria-label="WhatsApp support, available 24x7 (opens WhatsApp)"
          className={cn(
            itemBase,
            "text-foreground hover:bg-[#25D366]/10",
            collapsed && "w-10 justify-center px-0"
          )}
        >
          <WhatsappIcon className="size-4 text-[#25D366]" />
          <span className={cn("truncate", collapsed && "sr-only")}>WhatsApp help</span>
          {collapsed ? null : (
            <span className="ml-auto rounded-full bg-[#25D366]/15 px-1.5 py-px text-[10px] font-semibold text-[#128C4A] dark:text-[#4ade80]">
              24x7
            </span>
          )}
        </a>
        <div className={cn("grid grid-cols-2 gap-0.5", collapsed && "flex flex-col items-center")}>
          {navLink({
            href: tutorialsNav.href,
            label: tutorialsNav.label,
            icon: tutorialsNav.icon,
            active: isNavItemActive(tutorialsNav.href, pathname),
            iconClassName: "text-[#FF0000]",
          })}
          {navLink({
            href: helpNav.href,
            label: helpNav.label,
            icon: helpNav.icon,
            active: false,
          })}
        </div>

        <Link
          href="/dashboard/settings"
          prefetch={false}
          onClick={() => {
            setTip(null);
            onNavigate?.();
          }}
          {...tipHandlers(`${workspace} · ${planName} plan`)}
          title={collapsed ? undefined : `${profileName}${me?.user.email && me.user.email !== profileName ? ` · ${me.user.email}` : ""}`}
          className={cn(
            "mt-1 flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            collapsed && "mt-0.5 justify-center p-1"
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-soft text-xs font-semibold text-ink">
            {initials(workspace)}
          </span>
          <span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
            <span className="block truncate text-sm font-medium leading-tight text-ink">{workspace}</span>
            <span className="block truncate text-xs leading-tight text-muted">{me?.user.email ?? "Workspace"}</span>
          </span>
          <Badge variant="brand" className={cn("shrink-0", collapsed && "sr-only")}>
            {planName}
          </Badge>
        </Link>

        {onCollapsedChange && collapsed ? (
          <button
            type="button"
            onClick={() => {
              setTip(null);
              onCollapsedChange(false);
            }}
            {...tipHandlers("Expand sidebar")}
            aria-label="Expand sidebar"
            aria-expanded={false}
            className={cn(itemBase, itemIdle, "mt-0.5 w-10 justify-center px-0")}
          >
            <ChevronsLeft aria-hidden className="size-4 shrink-0 rotate-180" />
          </button>
        ) : null}
      </div>

      {collapsed && tip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-background shadow-md"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </span>
      ) : null}
    </aside>
  );
}
