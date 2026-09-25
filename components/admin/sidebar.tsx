"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { AdminAccountMenu } from "@/components/admin/account-menu";
import { adminNav } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-[240px] flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center px-4">
        <Logo href="/admin" className="h-8" />
      </div>
      <p className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
        Super Admin
      </p>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
        {adminNav.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
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
