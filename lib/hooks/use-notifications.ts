"use client";

import { useQuery } from "@tanstack/react-query";
import { asList } from "@/lib/dashboard/records";
import { api } from "@/lib/hooks/use-api";
import type { NotificationRecord } from "@/types/api";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

export function useNotifications() {
  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api<NotificationRecord[] | { items: NotificationRecord[] }>("/api/v1/notifications"),
    refetchInterval: 5000,
  });

  const items = asList<NotificationRecord>(query.data);
  const unread = items.filter((item) => !item.readAt && !item.read_at).length;

  return { ...query, items, unread };
}
