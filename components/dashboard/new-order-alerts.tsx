"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, X } from "lucide-react";
import { useNotifications } from "@/lib/hooks/use-notifications";
import {
  playNewOrderSound,
  unlockNewOrderSound,
  collectDashboardAlerts,
} from "@/lib/notifications/new-order";
import { cn } from "@/lib/utils";
import type { NotificationRecord } from "@/types/api";

function orderHref(item: NotificationRecord) {
  if (item.href) return item.href;
  const orderId = item.entityId ?? item.entity_id;
  return orderId ? `/dashboard/orders/${orderId}` : "/dashboard/orders";
}

export function NewOrderAlerts() {
  const router = useRouter();
  const notifications = useNotifications();
  const seen = useRef(new Set<string>());
  const startedAt = useRef(0);
  const primed = useRef(false);
  const [alerts, setAlerts] = useState<NotificationRecord[]>([]);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    function onIncoming(event: Event) {
      const detail = (event as CustomEvent<NotificationRecord[]>).detail;
      if (!Array.isArray(detail) || !detail.length) return;
      setAlerts(detail);
      try {
        playNewOrderSound();
      } catch {
        // Popup still shows if audio is blocked.
      }
    }
    window.addEventListener("postbus:new-shopify-orders", onIncoming);
    return () => window.removeEventListener("postbus:new-shopify-orders", onIncoming);
  }, []);

  useEffect(() => {
    function unlock() {
      unlockNewOrderSound();
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!startedAt.current) return;
    const items = notifications.items;
    if (!items.length && !notifications.isFetched) return;
    if (!primed.current) {
      for (const item of items) seen.current.add(item.id);
      primed.current = true;
      return;
    }
    const incoming = collectDashboardAlerts(items, seen.current, startedAt.current);
    if (!incoming.length) return;
    setAlerts(incoming);
    try {
      playNewOrderSound();
    } catch {
      // Popup still shows if audio is blocked.
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      const first = incoming[0];
      new Notification(
        incoming.length === 1 ? first.title || "Order update" : `${incoming.length} order updates`,
        {
          body:
            incoming.length === 1
              ? first.body || "An order just moved to the next stage."
              : "Orders just moved to the next stage.",
          tag: first.id,
        }
      );
    }
  }, [notifications.items, notifications.isFetched]);

  useEffect(() => {
    if (!alerts.length) return;
    const timer = window.setTimeout(() => setAlerts([]), 12_000);
    return () => window.clearTimeout(timer);
  }, [alerts]);

  if (!alerts.length) return null;

  const first = alerts[0];
  const title = alerts.length === 1 ? first.title || "Order update" : `${alerts.length} order updates`;
  const body =
    alerts.length === 1
      ? first.body || "An order just moved to the next stage."
      : "Orders just moved to the next stage.";
  const href = alerts.length === 1 ? orderHref(first) : "/dashboard/orders";

  return (
    <div
      className={cn(
        "fixed right-4 top-20 z-[80] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-brand/20 bg-card p-4 shadow-2xl"
      )}
      role="alertdialog"
      aria-label={title}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-muted">{body}</p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-brand hover:underline"
            onClick={() => {
              setAlerts([]);
              router.push(href);
            }}
          >
            View order
          </button>
        </div>
        <button
          type="button"
          className="rounded-full p-1 text-muted hover:bg-surface hover:text-ink"
          aria-label="Dismiss"
          onClick={() => setAlerts([])}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
