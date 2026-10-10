"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { BellRing, CircleCheck, X } from "lucide-react";
import { useNotifications } from "@/lib/hooks/use-notifications";
import {
  playDashboardAlertSound,
  unlockNewOrderSound,
  collectDashboardAlerts,
  isNewOrderCreatedNotification,
  rememberDashboardAlerts,
  DASHBOARD_ALERT_EVENT,
  LABELS_READY_NOTIFICATION,
  TRACKING_HOST_LIVE_NOTIFICATION,
} from "@/lib/notifications/new-order";
import { cn } from "@/lib/utils";
import type { NotificationRecord } from "@/types/api";

function orderHref(item: NotificationRecord) {
  if (item.type === TRACKING_HOST_LIVE_NOTIFICATION) {
    return item.body?.startsWith("http") ? item.body : "/dashboard/tracking";
  }
  if (item.type === LABELS_READY_NOTIFICATION) return "/dashboard/labels";
  if (item.href) return item.href;
  const orderId = item.entityId ?? item.entity_id;
  return orderId ? `/dashboard/orders/${orderId}` : "/dashboard/orders";
}

function actionLabel(item: NotificationRecord) {
  if (item.type === TRACKING_HOST_LIVE_NOTIFICATION) return "Open customer URL";
  return item.type === LABELS_READY_NOTIFICATION ? "View labels" : "View order";
}

function refreshOrdersIfCreated(queryClient: QueryClient, types: Array<string | null | undefined>) {
  if (!types.some((type) => isNewOrderCreatedNotification(type))) return;
  void queryClient.invalidateQueries({ queryKey: ["orders"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard-kpis"] });
}

export function NewOrderAlerts() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const [alerts, setAlerts] = useState<NotificationRecord[]>([]);

  useEffect(() => {
    function onIncoming(event: Event) {
      const detail = (event as CustomEvent<NotificationRecord[]>).detail;
      if (!Array.isArray(detail) || !detail.length) return;
      rememberDashboardAlerts(seen.current, detail);
      setAlerts(detail);
      void playDashboardAlertSound(detail.map((item) => item.type));
      refreshOrdersIfCreated(
        queryClient,
        detail.map((item) => item.type)
      );
    }
    window.addEventListener(DASHBOARD_ALERT_EVENT, onIncoming);
    return () => window.removeEventListener(DASHBOARD_ALERT_EVENT, onIncoming);
  }, [queryClient]);

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
    refreshOrdersIfCreated(
      queryClient,
      incoming.map((item) => item.type)
    );
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
  }, [notifications.items, notifications.isFetched, queryClient]);

  useEffect(() => {
    if (!alerts.length) return;
    const timer = window.setTimeout(() => setAlerts([]), 12_000);
    return () => window.clearTimeout(timer);
  }, [alerts]);

  if (!alerts.length) return null;

  const first = alerts[0];
  const labelsReady = first.type === LABELS_READY_NOTIFICATION;
  const hostLive = first.type === TRACKING_HOST_LIVE_NOTIFICATION;
  const successAlert = labelsReady || hostLive;
  const title =
    alerts.length === 1
      ? first.title || (labelsReady ? "Barcode and Packing slip Ready" : "Order update")
      : labelsReady
        ? `${alerts.length} label updates`
        : hostLive
          ? `${alerts.length} tracking page updates`
          : `${alerts.length} order updates`;
  const body =
    alerts.length === 1
      ? first.body || (labelsReady ? "Download the barcode and packing slip." : "An order just moved to the next stage.")
      : labelsReady
        ? "Barcode and packing slips are ready."
        : hostLive
          ? "Customer tracking addresses are live."
          : "Orders just moved to the next stage.";
  const href =
    alerts.length === 1
      ? orderHref(first)
      : labelsReady
        ? "/dashboard/labels"
        : hostLive
          ? "/dashboard/tracking"
          : "/dashboard/orders";

  return (
    <div
      className={cn(
        "fixed right-4 top-36 z-[80] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 shadow-2xl sm:top-32",
        successAlert ? "border-emerald-200" : "border-brand/20"
      )}
      role="alertdialog"
      aria-label={title}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-2xl",
            successAlert ? "bg-emerald-50 text-emerald-700" : "bg-brand/10 text-brand"
          )}
        >
          {successAlert ? <CircleCheck className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-muted">{body}</p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-brand hover:underline"
            onClick={() => {
              setAlerts([]);
              if (href.startsWith("http://") || href.startsWith("https://")) {
                window.open(href, "_blank", "noopener,noreferrer");
                return;
              }
              router.push(href);
            }}
          >
            {alerts.length === 1
              ? actionLabel(first)
              : labelsReady
                ? "View labels"
                : hostLive
                  ? "View tracking page"
                  : "View order"}
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
