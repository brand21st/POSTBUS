"use client";

import { useEffect } from "react";
import { useMe } from "@/lib/hooks/use-me";
import { analyticsUserFromMe, identifyUser } from "@/lib/analytics/posthog";

/** Mounted in the dashboard and admin shells: links PostHog events to the signed-in account. */
export function useIdentifyAnalyticsUser() {
  const me = useMe();
  const data = me.data;
  useEffect(() => {
    if (data?.user?.id) identifyUser(analyticsUserFromMe(data));
  }, [data]);
}
