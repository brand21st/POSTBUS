"use client";

import { useEffect, useRef, useState } from "react";
import type { StoreTrackingConfig } from "@/modules/storefront/config";
import { DEFAULT_STORE_TRACKING } from "@/modules/storefront/config";
import { commerceEvent, type CommerceEvent } from "@/modules/storefront/tracking-events";

type Consent = { analytics: boolean; marketing: boolean; decided: boolean };
const DENIED: Consent = { analytics: false, marketing: false, decided: false };
type TrackingWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][]; loaded?: boolean; version?: string; callMethod?: (...args: unknown[]) => void }; clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] } };
function gtmDocument(id: string, nonce: string) {
  return `<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><script>window.dataLayer=[];dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});const s=document.createElement('script');s.src='https://www.googletagmanager.com/gtm.js?id=${id}';s.async=true;document.head.append(s);addEventListener('message',function(e){if(e.source===parent&&e.data&&e.data.channel==='${nonce}'&&e.data.payload)dataLayer.push(e.data.payload)});<\/script></body></html>`;
}

export function StoreTracking({ workspace, config = DEFAULT_STORE_TRACKING, preview = false }: { workspace: string; config?: StoreTrackingConfig; preview?: boolean }) {
  const [consent, setConsent] = useState<Consent>(DENIED);
  const [preferences, setPreferences] = useState(false);
  const [draft, setDraft] = useState<Consent>(DENIED);
  const [events, setEvents] = useState<CommerceEvent[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const seen = useRef(new Set<string>());
  const active = [config.meta, config.ga4, config.clarity, config.gtm].some((p) => p.enabled && p.id);
  const consentKey = `postbus-consent:${workspace}:v1`;
  useEffect(() => {
    if (preview) return;
    try { const saved = JSON.parse(localStorage.getItem(consentKey) ?? "null"); if (saved?.decided) setConsent({ analytics: saved.analytics === true, marketing: saved.marketing === true, decided: true }); } catch { /* Storage is optional. */ }
  }, [consentKey, preview]);
  function choose(next: Consent) {
    setConsent(next); setDraft(next); setPreferences(false);
    try { localStorage.setItem(consentKey, JSON.stringify(next)); } catch { /* Storage is optional. */ }
  }
  useEffect(() => {
    if (preview || !consent.decided || !location.pathname.startsWith(`/store/${workspace}`)) return;
    const w = window as TrackingWindow;
    const scripts: HTMLScriptElement[] = [];
    const load = (src: string) => { const script = document.createElement("script"); script.src = src; script.async = true; script.referrerPolicy = "no-referrer"; document.head.append(script); scripts.push(script); };
    if (consent.analytics && config.ga4.enabled && config.ga4.id && config.ga4.delivery === "direct") {
      w.dataLayer ??= [];
      w.gtag ??= function () { w.dataLayer!.push(arguments); };
      w.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      w.gtag("consent", "update", { analytics_storage: "granted", ad_storage: consent.marketing ? "granted" : "denied", ad_user_data: "denied", ad_personalization: "denied" });
      w.gtag("js", new Date());
      w.gtag("config", config.ga4.id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
      load(`https://www.googletagmanager.com/gtag/js?id=${config.ga4.id}`);
    }
    if (consent.marketing && config.meta.enabled && config.meta.id && config.meta.delivery === "direct") {
      if (!w.fbq) { const fbq: NonNullable<TrackingWindow["fbq"]> = (...args) => fbq.callMethod ? fbq.callMethod(...args) : fbq.queue!.push(args); fbq.queue = []; fbq.loaded = true; fbq.version = "2.0"; w.fbq = fbq; }
      w.fbq("consent", "grant"); w.fbq("set", "autoConfig", false, config.meta.id); w.fbq("init", config.meta.id);
      load("https://connect.facebook.net/en_US/fbevents.js");
    }
    if (consent.analytics && config.clarity.enabled && config.clarity.id && config.clarity.delivery === "direct") {
      if (!w.clarity) { const clarity: NonNullable<TrackingWindow["clarity"]> = (...args) => { (clarity.q ??= []).push(args); }; w.clarity = clarity; }
      w.clarity("consentv2", { analytics_Storage: "granted", ad_Storage: consent.marketing ? "granted" : "denied" });
      load(`https://www.clarity.ms/tag/${config.clarity.id}`);
    }
    // A full navigation discards third-party globals when leaving this merchant.
    const boundary = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || anchor.target === "_blank") return;
      const url = new URL(anchor.href);
      if (url.origin === location.origin && !url.pathname.startsWith(`/store/${workspace}/`) && url.pathname !== `/store/${workspace}`) { event.preventDefault(); location.assign(url.href); }
    };
    document.addEventListener("click", boundary, true);
    return () => {
      w.gtag?.("consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      w.fbq?.("consent", "revoke"); w.clarity?.("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
      scripts.forEach((script) => script.remove()); document.removeEventListener("click", boundary, true);
      if (scripts.length) setTimeout(() => { if (!document.querySelector(`[data-store-tracking="${workspace}"]`)) location.reload(); }, 0);
    };
  }, [config, consent, preview, workspace]);
  useEffect(() => {
    function deliver(event: CommerceEvent) {
      if (preview) { setEvents((current) => [event, ...current].slice(0, 12)); return; }
      if (!consent.decided || (!consent.analytics && !consent.marketing) || !location.pathname.startsWith(`/store/${workspace}`)) return;
      const identity = event.name === "purchase" ? `purchase:${event.transactionId}` : event.eventId;
      if (seen.current.has(identity)) return;
      if (event.name === "purchase") {
        if (!event.transactionId) return;
        try { if (sessionStorage.getItem(`postbus-conversion:${workspace}:${identity}`)) return; sessionStorage.setItem(`postbus-conversion:${workspace}:${identity}`, "1"); } catch { /* In-memory dedupe still applies. */ }
      }
      seen.current.add(identity);
      const w = window as TrackingWindow;
      const payload = { event: event.name, event_id: event.eventId, currency: "INR", value: event.value, transaction_id: event.transactionId, items: event.items, page_location: `${location.origin}/store/${workspace}`, payment_status: event.name === "purchase" ? "pending" : undefined };
      if (consent.analytics && config.ga4.enabled && config.ga4.delivery === "direct") w.gtag?.("event", event.name, { ...payload, send_to: config.ga4.id });
      if (consent.marketing && config.meta.enabled && config.meta.delivery === "direct") {
        const names: Record<string, string> = { page_view: "PageView", view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };
        if (names[event.name]) w.fbq?.("trackSingle", config.meta.id, names[event.name], { currency: "INR", value: event.value, content_ids: event.items?.map((i) => i.item_id), contents: event.items?.map((i) => ({ id: i.item_id, quantity: i.quantity, item_price: i.price })), content_type: "product" }, { eventID: event.eventId });
      }
      if (consent.analytics && config.clarity.enabled && config.clarity.delivery === "direct") w.clarity?.("event", event.name);
      if (consent.analytics && consent.marketing && config.gtm.enabled) frame.current?.contentWindow?.postMessage({ channel, payload }, "*");
    }
    const listen = (input: Event) => { const detail = (input as CustomEvent<{ workspace: string; event: CommerceEvent }>).detail; if (detail.workspace === workspace) deliver(detail.event); };
    window.addEventListener("postbus:commerce", listen);
    deliver(commerceEvent("page_view", { eventId: `page:${workspace}` }));
    return () => window.removeEventListener("postbus:commerce", listen);
  }, [channel, config, consent, preview, workspace]);
  return <div data-store-tracking={workspace}>
    {!preview && config.gtm.enabled && config.gtm.id && consent.analytics && consent.marketing ? <iframe ref={frame} title="Store event tracking" sandbox="allow-scripts" srcDoc={gtmDocument(config.gtm.id, channel)} className="hidden" referrerPolicy="no-referrer" /> : null}
    {preview ? <details className="m-3 border-t border-zinc-200 py-2 text-xs text-zinc-500"><summary>Preview event inspector</summary><ul className="mt-2 space-y-1">{events.map((event, i) => <li key={`${event.eventId}:${i}`}>{event.name}{event.value !== undefined ? ` / INR ${event.value}` : ""}</li>)}</ul></details> : active ? <button className="mx-4 my-3 text-xs text-zinc-500 underline" onClick={() => { setDraft(consent); setPreferences(true); }}>Cookie preferences</button> : null}
    {!preview && active && (!consent.decided || preferences) ? <section role="dialog" aria-label="Cookie preferences" className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 shadow-lg"><h2 className="text-sm font-semibold">Your privacy choices</h2><p className="mt-1 text-xs leading-5 text-zinc-600">Choose whether this store can use analytics and advertising cookies. Shopping works with either choice.</p><div className="my-3 flex gap-5 text-xs"><label className="flex gap-2"><input type="checkbox" checked={draft.analytics} onChange={(e) => setDraft({ ...draft, analytics: e.target.checked })} />Analytics</label><label className="flex gap-2"><input type="checkbox" checked={draft.marketing} onChange={(e) => setDraft({ ...draft, marketing: e.target.checked })} />Marketing</label></div><div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2 text-xs" onClick={() => choose({ ...DENIED, decided: true })}>Reject optional</button><button className="rounded border px-3 py-2 text-xs" onClick={() => choose({ ...draft, decided: true })}>Save choices</button><button className="rounded bg-zinc-900 px-3 py-2 text-xs text-white" onClick={() => choose({ analytics: true, marketing: true, decided: true })}>Accept all</button></div></section> : null}
  </div>;
}
