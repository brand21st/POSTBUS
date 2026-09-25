"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { FEATURE } from "@/modules/billing/entitlements";
import { createClient } from "@/lib/supabase/client";
import type { DashboardAnalytics } from "@/types/api";

export const ANALYTICS_QUERY_KEY = ["dashboard-analytics"] as const;

export function useAnalytics() {
  const me = useMe();
  const queryClient = useQueryClient();
  const organizationId = me.data?.organization?.id;

  const query = useQuery({
    queryKey: ANALYTICS_QUERY_KEY,
    queryFn: () => api<DashboardAnalytics>("/api/v1/dashboard/analytics"),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    enabled:
      me.data?.subscription?.status === "TRIAL" ||
      (me.data?.subscription?.features ?? []).includes(FEATURE.analytics),
  });

  useEffect(() => {
    if (!organizationId) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel(`analytics:${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: ANALYTICS_QUERY_KEY });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "shipments",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: ANALYTICS_QUERY_KEY });
          }
        )
        .subscribe();
    } catch {
      // Polling still refreshes the page if Realtime is unavailable.
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [organizationId, queryClient]);

  return query;
}
