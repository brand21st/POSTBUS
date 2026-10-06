"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { ProductTour } from "@/components/dashboard/product-tour";
import { NewOrderAlerts } from "@/components/dashboard/new-order-alerts";
import { WebusbJobListener } from "@/components/dashboard/webusb-job-listener";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/hooks/use-api";
import { membershipsFromMe, useMe } from "@/lib/hooks/use-me";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { PlanLock } from "@/components/billing/plan-lock";
import { shouldMountDashboardChildren } from "@/lib/dashboard/shell-gate";

function DashboardPlanGate({ pathname, children }: { pathname: string; children: ReactNode }) {
  const entitlements = usePlanEntitlements();
  const lockedFeature = entitlements.loading ? null : entitlements.lockForPath(pathname);
  return (
    <div className="relative min-h-[12rem]">
      <div className={entitlements.loading ? "invisible" : undefined}>
        <PlanLock locked={!entitlements.loading && Boolean(lockedFeature)} feature={lockedFeature}>
          {children}
        </PlanLock>
      </div>
      {entitlements.loading ? (
        <div className="absolute inset-0">
          <Skeleton className="h-10 w-64" />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const [hydrated, setHydrated] = useState(false);
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

  useEffect(() => {
    setHydrated(true);
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

  const unauthorized = me.error instanceof ApiError && me.error.status === 401;
  const mountChildren = shouldMountDashboardChildren({
    isUnauthorized: unauthorized,
    hydrated,
    hasMe: Boolean(me.data),
  });

  return (
    <div className="flex w-full min-h-screen min-w-0 bg-surface">
      <Sidebar
        me={me.data}
        collapsed={collapsed || tablet}
        onCollapsedChange={setCollapsed}
        className="hidden md:flex"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar me={me.data} onMenuClick={() => setMobileOpen(true)} />
        <NewOrderAlerts />
        <WebusbJobListener />
        <main
          id="main-content"
          className={
            pathname === "/dashboard/orders"
              ? "min-w-0 flex-1 px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-4 xl:px-6"
              : "min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8"
          }
        >
          <div
            className={
              pathname === "/dashboard/orders"
                ? "mx-auto w-full min-w-0 max-w-full"
                : "mx-auto w-full min-w-0 max-w-[1280px]"
            }
          >
            {mountChildren ? (
              <DashboardPlanGate pathname={pathname}>{children}</DashboardPlanGate>
            ) : (
              <div>
                <Skeleton className="h-10 w-64" />
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <Skeleton className="h-28" />
                  <Skeleton className="h-28" />
                  <Skeleton className="h-28" />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} me={me.data} />
      <ProductTour userId={me.data?.user.id} />
    </div>
  );
}
