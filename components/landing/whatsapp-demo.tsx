"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  from: "bot" | "user";
  text: string;
  cta?: string;
};

const script: ChatMessage[] = [
  {
    id: "1",
    from: "bot",
    text: "Hi Rahul 👋\n\nYour order #PB10284 has been shipped.\n\nTracking Number:\nXXXXXXXXXXXX",
    cta: "Track Order",
  },
  { id: "2", from: "user", text: "Where is my order?" },
  {
    id: "3",
    from: "bot",
    text: "Your shipment is currently out for delivery.\n\nYou can track it here:",
    cta: "Track Shipment",
  },
  { id: "4", from: "user", text: "Thanks" },
  { id: "5", from: "bot", text: "You're welcome! 😊" },
];

function useReducedMotion() {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export function WhatsAppDemo({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <ChatShell className={className} messages={script} typing={false} />;
  }

  return <AnimatedChat className={className} />;
}

function AnimatedChat({ className }: { className?: string }) {
  const [visible, setVisible] = React.useState<ChatMessage[]>([]);
  const [typing, setTyping] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];

    const schedule = (fn: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms)
      );
    };

    let delay = 0;
    script.forEach((msg) => {
      if (msg.from === "bot") {
        schedule(() => setTyping(true), delay);
        delay += 700;
        schedule(() => {
          setTyping(false);
          setVisible((prev) => [...prev, msg]);
        }, delay);
        delay += 1100;
      } else {
        schedule(() => {
          setVisible((prev) => [...prev, msg]);
        }, delay);
        delay += 900;
      }
    });

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return <ChatShell className={className} messages={visible} typing={typing} />;
}

function ChatShell({
  className,
  messages,
  typing,
}: {
  className?: string;
  messages: ChatMessage[];
  typing: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[28px] border border-border bg-[#ECE5DD] card-shadow-lg",
        className
      )}
    >
      <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-bold">
          V
        </div>
        <div>
          <p className="text-sm font-semibold">Vachat</p>
          <p className="text-xs text-white/75">WhatsApp AI · Rahul</p>
        </div>
      </div>

      <div className="flex min-h-[420px] flex-col gap-2.5 p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-line",
              msg.from === "bot"
                ? "self-start rounded-tl-md bg-white text-ink"
                : "self-end rounded-tr-md bg-[#DCF8C6] text-ink"
            )}
          >
            {msg.text}
            {msg.cta ? (
              <span className="mt-2 block rounded-lg bg-brand/10 px-3 py-2 text-center text-xs font-semibold text-brand">
                {msg.cta}
              </span>
            ) : null}
            <span className="mt-1 block text-right text-[10px] text-muted">
              {msg.from === "bot" ? "Delivered" : "Read"}
            </span>
          </div>
        ))}
        {typing ? (
          <div className="flex self-start items-center gap-1 rounded-2xl rounded-tl-md bg-white px-3 py-2.5 shadow-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-zinc-400" />
            <span className="size-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:120ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:240ms]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
