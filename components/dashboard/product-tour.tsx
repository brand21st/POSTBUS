"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { destroyDashboardTour, startDashboardTour } from "@/lib/dashboard/product-tour";

export function ProductTour({ userId }: { userId?: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/dashboard" || !userId) {
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
  }, [pathname, userId]);

  return null;
}
