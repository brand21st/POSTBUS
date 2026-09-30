"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { asList } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRecord } from "@/types/api";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
export const NOTIFICATIONS_REFETCH_INTERVAL_MS = 45_000;

export function useNotifications() {
  const me = useMe();
  const queryClient = useQueryClient();
  const organizationId = me.data?.organization?.id;

  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api<NotificationRecord[] | { items: NotificationRecord[] }>("/api/v1/notifications"),
    refetchInterval: NOTIFICATIONS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!organizationId) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel(`notifications:${organizationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `organization_id=eq.${organizationId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
          }
        )
        .subscribe();
    } catch {
      // 45s polling still refreshes if Realtime is unavailable.
    }
    return () => {
      if (channel) void channel.unsubscribe();
    };
  }, [organizationId, queryClient]);

  const items = asList<NotificationRecord>(query.data);
  const unread = items.filter((item) => !item.readAt && !item.read_at).length;

  return { ...query, items, unread };
}
