"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clipboard, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  applyWhatsAppCustomerFields,
  type WhatsAppCustomerFields,
} from "@/lib/parsers/whatsapp-customer-message";

const MAX_CHARS = 2000;
const CLEAR_CONFIRM_CHARS = 20;
const PLACEHOLDER = `Name: Rahul
Phone: 9876543210
Address: 12 ABC House, Main Road
City: Kozhikode
State: Kerala
PIN: 673001`;

type ParseResponse = {
  fields: WhatsAppCustomerFields;
  source: "ai" | "rules";
  creditsRemaining?: number;
};

type CreditsResponse = {
  remaining: number;
  included?: number;
  packSize?: number;
  packPaise?: number;
  purchased?: number;
  used?: number;
};

const FREE_CREDITS = 500;
const LOW_CREDITS = 25;

export function WhatsAppPasteParser({
  getCurrent,
  onApply,
  overwrite = false,
}: {
  getCurrent: () => WhatsAppCustomerFields;
  onApply: (fields: WhatsAppCustomerFields) => void;
  overwrite?: boolean;
}) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const inflight = useRef(false);
  const queryClient = useQueryClient();
  const credits = useQuery({
    queryKey: ["ai-credits"],
    queryFn: () => api<CreditsResponse>("/api/v1/ai-credits"),
  });
  const included = credits.data?.included ?? FREE_CREDITS;
  const remaining = credits.isSuccess ? credits.data.remaining : included;
  const outOfCredits = credits.isSuccess && remaining === 0;
  const creditLabel =
    remaining > included ? String(remaining) : `${remaining}/${included}`;

  async function parse() {
    const paste = text.trim();
    if (!paste || inflight.current) return;
    inflight.current = true;
    setParsing(true);
    setHint(null);
    try {
      const parsed = await api<ParseResponse>("/api/v1/orders/whatsapp-parse", {
        method: "POST",
        body: JSON.stringify({
          text: paste.slice(0, MAX_CHARS),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const filled = Object.values(parsed.fields).filter(Boolean).length;
      if (!filled) {
        setHint("Could not read name, phone, or address from that message. Fill the fields manually.");
        return;
      }
      if (typeof parsed.creditsRemaining === "number") {
        queryClient.setQueryData(["ai-credits"], (current: CreditsResponse | undefined) =>
          current
            ? { ...current, remaining: parsed.creditsRemaining as number }
            : {
                remaining: parsed.creditsRemaining as number,
                included: FREE_CREDITS,
              }
        );
      }
      onApply(applyWhatsAppCustomerFields(getCurrent(), parsed.fields, { overwrite }));
      const via = parsed.source === "ai" ? " with AI" : "";
      setHint(
        overwrite
          ? `Updated ${filled} field${filled === 1 ? "" : "s"}${via}. Review before saving.`
          : `Filled ${filled} field${filled === 1 ? "" : "s"}${via}. Empty fields only — review before saving.`
      );
    } catch (error) {
      setHint(error instanceof Error ? error.message : "Could not parse that message.");
    } finally {
      inflight.current = false;
      setParsing(false);
    }
  }

  function clear() {
    if (text.trim().length > CLEAR_CONFIRM_CHARS) {
      const ok = window.confirm("Clear the pasted customer details?");
      if (!ok) return;
    }
    setText("");
    setHint(null);
  }

  const count = text.length;

  return (
    <section
      className="rounded-2xl border border-border bg-card p-3 shadow-[0_1px_2px_rgb(9_9_11/0.04),0_8px_24px_rgb(9_9_11/0.04)] sm:p-4 lg:p-5"
      aria-labelledby="whatsapp-paste-heading"
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-start gap-2 sm:gap-3">
          <img
            src="/WhatsApp.svg"
            alt=""
            width={40}
            height={40}
            className="size-8 shrink-0 object-contain sm:size-10"
            aria-hidden
          />
          <div className="min-w-0">
            <h3 id="whatsapp-paste-heading" className="text-sm font-semibold tracking-tight text-ink sm:text-base">
              Paste customer details
            </h3>
            <p className="mt-0.5 text-xs leading-snug text-muted sm:text-sm">
              <span className="sm:hidden">Paste a WhatsApp message — AI fills the form.</span>
              <span className="hidden sm:inline">
                Paste a WhatsApp message or customer address — AI will extract the details automatically.
              </span>
            </p>
          </div>
        </div>
        {outOfCredits ? (
          <Link
            href="/dashboard/billing#ai-credits"
            className="flex shrink-0 items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 sm:px-3 sm:text-xs"
          >
            Recharge now
          </Link>
        ) : (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 sm:px-2.5",
              remaining <= 20
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-100 bg-emerald-50 text-emerald-800"
            )}
            title={`${remaining} AI credits remaining`}
          >
            <Sparkles className="size-3.5 shrink-0" aria-hidden />
            <p className="text-[11px] font-semibold leading-none sm:text-xs">
              <span className="tabular-nums">{creditLabel}</span>
              <span className="ml-1 font-medium text-current/70">AI</span>
            </p>
          </div>
        )}
      </div>

      <div className="relative mt-3 sm:mt-4">
        <label className="sr-only" htmlFor="whatsapp-paste">
          Paste customer details from WhatsApp
        </label>
        <Textarea
          id="whatsapp-paste"
          value={text}
          maxLength={MAX_CHARS}
          disabled={parsing}
          onChange={(event) => {
            setText(event.target.value.slice(0, MAX_CHARS));
            setHint(null);
          }}
          placeholder={PLACEHOLDER}
          className="min-h-36 resize-y bg-surface-soft pb-10 text-base leading-relaxed shadow-none placeholder:text-zinc-500 sm:min-h-44 sm:pb-12 sm:text-sm md:min-h-52 dark:placeholder:text-zinc-400"
          aria-describedby="whatsapp-paste-help whatsapp-paste-count"
        />
        <div className="pointer-events-none absolute inset-x-2.5 bottom-1.5 flex items-end justify-between gap-2 text-[10px] text-muted sm:inset-x-3 sm:bottom-2 sm:text-[11px]">
          <p id="whatsapp-paste-help" className="flex min-w-0 items-center gap-1 sm:gap-1.5">
            <Clipboard className="size-3 shrink-0 sm:size-3.5" aria-hidden />
            <span className="truncate sm:hidden">Paste from WhatsApp</span>
            <span className="hidden sm:inline">You can paste from WhatsApp, copy & paste or type manually.</span>
          </p>
          <p id="whatsapp-paste-count" className="shrink-0 tabular-nums" aria-live="polite">
            {count}/{MAX_CHARS}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 sm:mt-4">
        <Button
          type="button"
          size="default"
          className={cn(
            "h-11 min-w-0 flex-1 text-white shadow-sm sm:h-12 sm:flex-none sm:px-6 sm:text-base",
            "!bg-[#25D366] hover:!bg-[#20bd5a] hover:shadow-md"
          )}
          disabled={!text.trim() || parsing || outOfCredits}
          aria-busy={parsing}
          onClick={() => void parse()}
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          {parsing ? "Extracting..." : "Extract with AI"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="default"
          className="h-11 w-11 shrink-0 px-0 sm:h-12 sm:w-auto sm:px-5 sm:text-base"
          disabled={parsing || !text}
          aria-label="Clear pasted details"
          title="Clear"
          onClick={clear}
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Clear</span>
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted sm:mt-3 sm:text-sm" role={hint ? "status" : undefined} aria-live={hint ? "polite" : undefined}>
        {outOfCredits ? (
          <>
            You&apos;re out of AI Credits.{" "}
            <Link href="/dashboard/billing#ai-credits" className="font-medium text-brand underline-offset-2 hover:underline">
              Buy Credits
            </Link>
          </>
        ) : remaining <= LOW_CREDITS && credits.isSuccess ? (
          <>
            Only {remaining} AI Credits remaining.{" "}
            <Link href="/dashboard/billing#ai-credits" className="font-medium text-brand underline-offset-2 hover:underline">
              Buy Credits
            </Link>
            {hint ? ` ${hint}` : ""}
          </>
        ) : (
          hint ??
          (overwrite
            ? "1 credit per successful extract. Extract updates name, phone, and address."
            : "1 credit per successful extract. Extract fills empty fields below.")
        )}
      </p>
    </section>
  );
}
