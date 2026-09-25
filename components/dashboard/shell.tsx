"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { NewOrderAlerts } from "@/components/dashboard/new-order-alerts";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/hooks/use-api";
import { membershipsFromMe, useMe } from "@/lib/hooks/use-me";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { PlanLock } from "@/components/billing/plan-lock";

function DashboardPlanGate({ pathname, children }: { pathname: string; children: ReactNode }) {
  const entitlements = usePlanEntitlements();
  const lockedFeature = entitlements.loading ? null : entitlements.lockForPath(pathname);
  return (
    <PlanLock locked={Boolean(lockedFeature)} feature={lockedFeature}>
      {children}
    </PlanLock>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const [collapsed, setCollapsed] = useState(false);
  const [tablet, setTablet] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const sync = () => setTablet(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  useEffect(() => {
    if (me.isLoading) return;
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!me.data?.organization && membershipsFromMe(me.data).length === 0) {
      router.replace("/onboarding");
    }
  }, [me.data, me.error, me.isLoading, pathname, router]);

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen bg-surface">
        <div className="hidden w-[260px] border-r border-border bg-card p-4 lg:block">
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-10 w-64" />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        me={me.data}
        collapsed={collapsed || tablet}
        onCollapsedChange={setCollapsed}
        className="hidden md:flex"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar me={me.data} onMenuClick={() => setMobileOpen(true)} />
        <NewOrderAlerts />
        <main id="main-content" className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1280px]">
            <DashboardPlanGate pathname={pathname}>{children}</DashboardPlanGate>
          </div>
        </main>
      </div>
      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} me={me.data} />
    </div>
  );
}
