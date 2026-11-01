"use client";

import { useEffect } from "react";
import { PRESENCE_WRITE_MIN_MS } from "@/lib/admin/user-presence";
import { api } from "@/lib/hooks/use-api";

export function useUserPresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let lastSent = 0;
    let timer = 0;

    const send = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (lastSent > 0 && now - lastSent < PRESENCE_WRITE_MIN_MS) return;
      lastSent = now;
      void api("/api/v1/me/presence", { method: "POST" }).catch(() => undefined);
    };

    send();
    timer = window.setInterval(send, PRESENCE_WRITE_MIN_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
    };
  }, [enabled]);
}
