"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";

export const SUPPORT_UNREAD_QUERY_KEY = ["support", "unread"] as const;

export function useSupportUnread() {
  const me = useMe();
  const queryClient = useQueryClient();
  const organizationId = me.data?.organization?.id;
  const query = useQuery({
    queryKey: SUPPORT_UNREAD_QUERY_KEY,
    queryFn: () => api<{ count: number }>("/api/v1/support/unread"),
    enabled: Boolean(organizationId),
    refetchInterval: 45_000,
  });

  useEffect(() => {
    if (!organizationId) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel(`support-unread:${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "support_conversations",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_QUERY_KEY });
          }
        )
        .subscribe();
    } catch {
      // polling still refreshes
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [organizationId, queryClient]);

  return { ...query, count: query.data?.count ?? 0 };
}
