"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  destroyDashboardTour,
  PRODUCT_TOUR_EVENT,
  PRODUCT_TOUR_REPLAY_KEY,
  startDashboardTour,
} from "@/lib/dashboard/product-tour";

export function ProductTour({ userId }: { userId?: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/dashboard" || !userId) {
      destroyDashboardTour();
      return;
    }

    const id = userId;

    function start(force: boolean) {
      startDashboardTour({ userId: id, force });
    }

    function consumeReplayFlag() {
      try {
        const replay = window.sessionStorage.getItem(PRODUCT_TOUR_REPLAY_KEY) === "1";
        if (replay) window.sessionStorage.removeItem(PRODUCT_TOUR_REPLAY_KEY);
        return replay;
      } catch {
        return false;
      }
    }

    const timer = window.setTimeout(() => {
      start(consumeReplayFlag());
    }, 450);

    function onReplay() {
      try {
        window.sessionStorage.removeItem(PRODUCT_TOUR_REPLAY_KEY);
      } catch {
        // ignore
      }
      start(true);
    }

    window.addEventListener(PRODUCT_TOUR_EVENT, onReplay);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PRODUCT_TOUR_EVENT, onReplay);
      destroyDashboardTour();
    };
  }, [pathname, userId]);

  return null;
}
