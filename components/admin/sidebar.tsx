"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { AdminAccountMenu } from "@/components/admin/account-menu";
import { adminNav } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

export function AdminSidebar({ onNavigate, className }: { onNavigate?: () => void; className?: string } = {}) {
  const pathname = usePathname();
  return (
    <aside className={cn("sticky top-0 flex h-svh w-[232px] flex-col border-r border-border bg-card", className)}>
      <div className="flex h-14 shrink-0 items-center px-3">
        <Logo href="/admin" className="[&_img]:h-8 [&_img]:sm:h-8" />
      </div>
      <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
        Super Admin
      </p>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4" aria-label="Super Admin">
        {adminNav.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                active ? "bg-rose-100 text-brand-dark" : "text-muted hover:bg-surface-soft hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <AdminAccountMenu />
      </div>
    </aside>
  );
}
