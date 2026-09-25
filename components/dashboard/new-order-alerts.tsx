"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleCheck, X } from "lucide-react";
import { useNotifications } from "@/lib/hooks/use-notifications";
import {
  playDashboardAlertSound,
  unlockNewOrderSound,
  collectDashboardAlerts,
  LABELS_READY_NOTIFICATION,
} from "@/lib/notifications/new-order";
import { cn } from "@/lib/utils";
import type { NotificationRecord } from "@/types/api";

function orderHref(item: NotificationRecord) {
  if (item.type === LABELS_READY_NOTIFICATION) return "/dashboard/labels";
  if (item.href) return item.href;
  const orderId = item.entityId ?? item.entity_id;
  return orderId ? `/dashboard/orders/${orderId}` : "/dashboard/orders";
}

function actionLabel(item: NotificationRecord) {
  return item.type === LABELS_READY_NOTIFICATION ? "View labels" : "View order";
}

export function NewOrderAlerts() {
  const router = useRouter();
  const notifications = useNotifications();
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const [alerts, setAlerts] = useState<NotificationRecord[]>([]);

  useEffect(() => {
    function onIncoming(event: Event) {
      const detail = (event as CustomEvent<NotificationRecord[]>).detail;
      if (!Array.isArray(detail) || !detail.length) return;
      setAlerts(detail);
      void playDashboardAlertSound(detail.map((item) => item.type));
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
    const items = notifications.items;
    if (!items.length && !notifications.isFetched) return;
    if (!primed.current) {
      for (const item of items) seen.current.add(item.id);
      primed.current = true;
      return;
    }
    const incoming = collectDashboardAlerts(items, seen.current, 0);
    if (!incoming.length) return;
    setAlerts(incoming);
    void playDashboardAlertSound(incoming.map((item) => item.type));
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
  const labelsReady = first.type === LABELS_READY_NOTIFICATION;
  const title =
    alerts.length === 1
      ? first.title || (labelsReady ? "Barcode and Packing slip Ready" : "Order update")
      : labelsReady
        ? `${alerts.length} label updates`
        : `${alerts.length} order updates`;
  const body =
    alerts.length === 1
      ? first.body || (labelsReady ? "Download the barcode and packing slip." : "An order just moved to the next stage.")
      : labelsReady
        ? "Barcode and packing slips are ready."
        : "Orders just moved to the next stage.";
  const href = alerts.length === 1 ? orderHref(first) : labelsReady ? "/dashboard/labels" : "/dashboard/orders";

  return (
    <div
      className={cn(
        "fixed right-4 top-20 z-[80] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 shadow-2xl",
        labelsReady ? "border-emerald-200" : "border-brand/20"
      )}
      role="alertdialog"
      aria-label={title}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-2xl",
            labelsReady ? "bg-emerald-50 text-emerald-700" : "bg-brand/10 text-brand"
          )}
        >
          {labelsReady ? <CircleCheck className="size-5" /> : <BellRing className="size-5" />}
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
            {alerts.length === 1 ? actionLabel(first) : labelsReady ? "View labels" : "View order"}
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
