"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";
import type { PrintStation } from "@/types/api";

export const PRINT_STATION_QUERY_KEY = ["print-station"] as const;

export function usePrintStation() {
  const me = useMe();
  const queryClient = useQueryClient();
  const organizationId = me.data?.organization?.id;

  const query = useQuery({
    queryKey: PRINT_STATION_QUERY_KEY,
    queryFn: () => api<PrintStation>("/api/v1/print-station"),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  useEffect(() => {
    if (!organizationId) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel(`print-station:${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "print_agents",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: PRINT_STATION_QUERY_KEY });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "print_jobs",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: PRINT_STATION_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: ["labels"] });
          }
        )
        .subscribe();
    } catch {
      // Polling still refreshes if Realtime is unavailable.
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [organizationId, queryClient]);

  return query;
}
