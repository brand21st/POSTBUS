"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeIndianRupee,
  CircleHelp,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Megaphone,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { resetAnalyticsUser } from "@/lib/analytics/posthog";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  ["/partner/dashboard", "Overview", LayoutDashboard],
  ["/partner/links", "Referral links", Link2],
  ["/partner/campaigns", "Campaigns", Megaphone],
  ["/partner/referrals", "My referrals", Users],
  ["/partner/commissions", "Commissions", BadgeIndianRupee],
  ["/partner/payouts", "Payouts", Wallet],
  ["/partner/profile", "Profile", UserRound],
  ["/partner/support", "Help & support", CircleHelp],
] as const;

export function PartnerShell({
  children,
  status,
  email,
}: {
  children: ReactNode;
  status?: string;
  email?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className={cn("border-r border-border bg-card lg:sticky lg:top-0 lg:h-screen", open ? "fixed inset-0 z-40 lg:static" : "hidden lg:block")}>
        <div className="flex items-center justify-between p-4">
          <Link href="/partner/dashboard" className="font-semibold text-brand">
            PostBus Partner
          </Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="grid gap-1 p-3" aria-label="Partner">
          {NAV.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
                pathname === href ? "bg-surface-soft font-medium text-ink" : "text-muted hover:bg-surface-soft"
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 hidden border-t border-border p-4 lg:block">
          <p className="truncate text-xs text-muted">{email}</p>
          <Link href="/dashboard" className="mt-2 block text-sm underline">
            Merchant workspace
          </Link>
        </div>
      </aside>
      <div>
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <p className="text-sm text-muted">Partner workspace</p>
          <div className="flex items-center gap-2">
            {status ? <span className="rounded-full bg-surface-soft px-3 py-1 text-xs font-medium">{status}</span> : null}
            <Button
              variant="secondary"
              onClick={() => {
                resetAnalyticsUser();
                void createClient().auth.signOut().then(() => {
                  window.location.href = "/partner/login";
                });
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </header>
        <div className="mx-auto w-full max-w-7xl p-4 md:p-8">{children}</div>
      </div>
    </div>
  );
}
