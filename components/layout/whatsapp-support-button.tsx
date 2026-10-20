"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const ASK_TITLE = "Any help you need?";
const ASK_SUBTITLE = "24x7 WhatsApp Support";
const ASK_MESSAGE = `${ASK_TITLE} ${ASK_SUBTITLE}`;

const CHAT_FAQS = [
  "What is PostBus?",
  "Do I need an India Post Customer ID?",
  "How does the free trial work?",
] as const;

function waHref(text?: string) {
  const base = `https://wa.me/${siteConfig.supportWhatsapp}`;
  const trimmed = text?.trim();
  if (!trimmed) return base;
  return `${base}?text=${encodeURIComponent(trimmed)}`;
}

function openWhatsApp(text: string) {
  window.open(waHref(text), "_blank", "noopener,noreferrer");
}

export function WhatsappSupportButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const openedByUser = useRef(false);
  const panelId = useId();
  const hideOnShopify = pathname === "/shopify" || pathname.startsWith("/shopify/");

  useEffect(() => {
    if (open && openedByUser.current) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggle() {
    openedByUser.current = true;
    setOpen((current) => !current);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    openWhatsApp(text);
  }

  if (hideOnShopify) return null;

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-[59] cursor-default bg-transparent"
          aria-label="Close WhatsApp chat"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div className="fixed right-5 bottom-5 z-[60] flex flex-col items-end gap-3 sm:bottom-6">
        {open ? (
          <section
            id={panelId}
            role="dialog"
            aria-labelledby={`${panelId}-title`}
            className="w-[min(20.5rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_18px_50px_rgb(15_23_42/0.22)]"
          >
            <header className="flex items-center gap-3 bg-[#075E54] px-3.5 py-3 text-white">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                <WhatsappIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={`${panelId}-title`} className="truncate text-sm font-semibold">
                  PostBus Support
                </h2>
                <p className="text-xs text-white/80">{ASK_SUBTITLE}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-white/90 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                aria-label="Close chat"
              >
                <CloseIcon />
              </button>
            </header>
            <div className="space-y-2.5 bg-[#ece5dd] px-3.5 py-3.5">
              <p className="max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm leading-relaxed text-ink shadow-sm">
                <span className="block font-semibold">{ASK_TITLE}</span>
                {ASK_SUBTITLE}
              </p>
              <ul className="space-y-2">
                {CHAT_FAQS.map((question) => (
                  <li key={question}>
                    <a
                      href={waHref(question)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-2xl rounded-tr-sm border border-[#25D366]/25 bg-white px-3 py-2 text-left text-sm font-medium text-[#075E54] shadow-sm transition hover:border-[#25D366]/50 hover:bg-[#f7fff9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
                    >
                      {question}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <form
              onSubmit={onSubmit}
              className="flex items-center gap-2 border-t border-black/5 bg-white p-2.5"
            >
              <label htmlFor={`${panelId}-message`} className="sr-only">
                Message
              </label>
              <input
                id={`${panelId}-message`}
                ref={inputRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type a message…"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-full border border-black/10 bg-[#f0f2f5] px-3.5 py-2 text-sm text-ink outline-none placeholder:text-muted focus-visible:border-[#25D366] focus-visible:ring-2 focus-visible:ring-[#25D366]/30"
              />
              <button
                type="submit"
                aria-label="Send on WhatsApp"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white transition hover:bg-[#1ebe5d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] disabled:opacity-40"
                disabled={!message.trim()}
              >
                <SendIcon />
              </button>
            </form>
          </section>
        ) : (
          <button
            type="button"
            onClick={toggle}
            className="max-w-[15.5rem] rounded-2xl rounded-br-sm border border-black/5 bg-white px-3.5 py-2.5 text-left shadow-[0_10px_28px_rgb(15_23_42/0.16)] transition hover:bg-[#f7fff9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
          >
            <span className="block text-sm font-semibold text-ink">{ASK_TITLE}</span>
            <span className="text-xs text-muted">{ASK_SUBTITLE}</span>
          </button>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close WhatsApp Support" : ASK_MESSAGE}
          className="flex items-center gap-2.5 rounded-full bg-[#25D366] p-3 text-white shadow-[0_8px_28px_rgb(37_211_102/0.45)] transition hover:bg-[#1ebe5d] hover:shadow-[0_10px_32px_rgb(37_211_102/0.55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
        >
          {open ? <CloseIcon className="size-6" /> : <WhatsappIcon />}
        </button>
      </div>
    </>
  );
}

export function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-6 shrink-0 fill-current", className)}
    >
      <path d="M12.04 2C6.58 2 2.15 6.43 2.15 11.89c0 1.76.46 3.48 1.34 5L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.89-4.43 9.89-9.89C21.94 6.43 17.5 2 12.04 2Zm5.75 14.07c-.24.67-1.4 1.24-1.94 1.32-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.26-4.79-4.19-4.94-4.38-.14-.2-1.18-1.57-1.18-3 0-1.42.74-2.12 1.01-2.41.26-.28.58-.35.77-.35h.56c.18 0 .42-.07.65.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.2-.14.32-.28.5-.14.17-.3.38-.42.51-.14.14-.29.3-.12.58.16.28.73 1.2 1.57 1.94 1.08.96 1.99 1.26 2.27 1.4.28.14.44.12.6-.07.17-.2.7-.81.88-1.09.19-.28.37-.23.63-.14.26.1 1.64.77 1.92.91.28.14.47.21.54.33.07.12.07.7-.17 1.37Z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)} fill="none" stroke="currentColor" strokeWidth="2.2">
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M3.4 20.6 21 12 3.4 3.4l.1 6.7L15 12 3.5 13.9z" />
    </svg>
  );
}
