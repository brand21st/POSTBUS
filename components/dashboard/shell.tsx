"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { IndiaPostOnboardingHost } from "@/components/dashboard/india-post-onboarding-host";
import { ProductTour } from "@/components/dashboard/product-tour";
import { NewOrderAlerts } from "@/components/dashboard/new-order-alerts";
import { WebusbJobListener } from "@/components/dashboard/webusb-job-listener";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { Skeleton } from "@/components/ui/skeleton";
import { isConfirmedSessionLoss, isTransientApiAuthError } from "@/lib/hooks/use-api";
import { membershipsFromMe, useMe } from "@/lib/hooks/use-me";
import { useUserPresenceHeartbeat } from "@/lib/hooks/use-user-presence-heartbeat";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { PlanLock } from "@/components/billing/plan-lock";
import { TrialEndedModal } from "@/components/billing/trial-ended-modal";
import { TrialStatusBar } from "@/components/dashboard/trial-status-bar";
import { trialBannerCopy } from "@/modules/billing/trial-policy";
import {
  shouldMountDashboardChildren,
  shouldRedirectToLoginFromMe,
  shouldRedirectToOnboardingFromMe,
} from "@/lib/dashboard/shell-gate";

function subscribeNever() {
  return () => {};
}

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

export function DashboardShell({
  children,
  announcement,
}: {
  children: ReactNode;
  announcement?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
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

  const subscription = me.data?.subscription;
  const [trialElapsed, setTrialElapsed] = useState(false);
  const trialExpired =
    subscription?.status === "EXPIRED" ||
    ((subscription?.status === "TRIAL" || Boolean(subscription?.trial)) &&
      (Boolean(subscription?.coverageEnded) || trialElapsed));
  const trialCopy = trialBannerCopy({
    trial: Boolean(subscription?.trial) && !trialElapsed,
    coverageEnded: trialExpired,
    trialEnd: subscription?.trialEnd,
  });

  useEffect(() => {
    setTrialElapsed(false);
    const end = subscription?.trialEnd ? Date.parse(subscription.trialEnd) : NaN;
    if (!subscription?.trial || !Number.isFinite(end)) return;
    const wait = end - Date.now();
    if (wait <= 0) {
      setTrialElapsed(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setTrialElapsed(true);
      void me.refetch();
    }, Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [me.refetch, subscription?.trial, subscription?.trialEnd]);

  const confirmedLoss = isConfirmedSessionLoss(me.error);
  const transientAuth = isTransientApiAuthError(me.error);
  useUserPresenceHeartbeat(Boolean(me.data) && !confirmedLoss);

  useEffect(() => {
    if (
      shouldRedirectToLoginFromMe({
        isLoading: me.isLoading,
        isConfirmedSessionLoss: confirmedLoss,
        isTransient: transientAuth,
      })
    ) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (
      shouldRedirectToOnboardingFromMe({
        isLoading: me.isLoading,
        hasError: Boolean(me.error),
        isConfirmedSessionLoss: confirmedLoss,
        isTransient: transientAuth,
        hasOrganization: Boolean(me.data?.organization),
        membershipCount: membershipsFromMe(me.data).length,
      })
    ) {
      router.replace("/onboarding");
    }
  }, [confirmedLoss, me.data, me.error, me.isLoading, pathname, router, transientAuth]);

  const mountChildren = shouldMountDashboardChildren({
    isUnauthorized: confirmedLoss,
    hydrated,
    hasMe: Boolean(me.data),
    isTransient: transientAuth,
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
        <div className="sticky top-0 z-30 bg-background">
          {trialCopy ? <TrialStatusBar {...trialCopy} /> : announcement}
          <Topbar me={me.data} onMenuClick={() => setMobileOpen(true)} />
        </div>
        {me.data && !confirmedLoss ? <NewOrderAlerts /> : null}
        {me.data && !confirmedLoss ? <WebusbJobListener /> : null}
        <main
          id="main-content"
          className={
            pathname === "/dashboard/orders" || pathname.startsWith("/dashboard/support")
              ? "min-w-0 flex-1 px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-4 xl:px-6"
              : "min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8"
          }
        >
          <div
            className={
              pathname === "/dashboard/orders" || pathname.startsWith("/dashboard/support")
                ? "mx-auto w-full min-w-0 max-w-full"
                : "mx-auto w-full min-w-0 max-w-[1280px]"
            }
          >
            {me.data && !confirmedLoss ? <IndiaPostOnboardingHost /> : null}
            {transientAuth ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted">
                <p>Connection issue. Retrying your session without signing you out…</p>
                {me.isFetching ? null : (
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1 text-ink"
                    onClick={() => void me.refetch()}
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : null}
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
      <TrialEndedModal open={Boolean(trialExpired)} />
    </div>
  );
}
