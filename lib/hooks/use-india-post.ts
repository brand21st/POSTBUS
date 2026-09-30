"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";
import type { IndiaPostConfig } from "@/types/api";

export const INDIA_POST_QUERY_KEY = ["india-post"] as const;

export function useIndiaPost() {
  const me = useMe();
  const queryClient = useQueryClient();
  const organizationId = me.data?.organization?.id;

  const query = useQuery({
    queryKey: INDIA_POST_QUERY_KEY,
    queryFn: () => api<IndiaPostConfig>("/api/v1/integrations/india-post"),
  });

  useEffect(() => {
    if (!organizationId) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel(`india-post:${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "india_post_connections",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "india_post_contracts",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: INDIA_POST_QUERY_KEY });
          }
        )
        .subscribe();
    } catch {
      // Query invalidation from mutations still keeps Default in sync.
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [organizationId, queryClient]);

  return query;
}
