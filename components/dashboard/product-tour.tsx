"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { destroyDashboardTour, startDashboardTour } from "@/lib/dashboard/product-tour";
import { useIndiaPostOnboarding } from "@/lib/hooks/use-india-post-onboarding";

export function ProductTour({ userId }: { userId?: string | null }) {
  const pathname = usePathname();
  const { showModal } = useIndiaPostOnboarding();

  useEffect(() => {
    if (showModal || pathname !== "/dashboard" || !userId) {
      destroyDashboardTour();
      return;
    }

    const id = userId;
    const timer = window.setTimeout(() => {
      startDashboardTour({ userId: id });
    }, 450);

    return () => {
      window.clearTimeout(timer);
      destroyDashboardTour();
    };
  }, [pathname, showModal, userId]);

  return null;
}
