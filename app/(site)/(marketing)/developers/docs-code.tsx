"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export type CodeSample = {
  label: string;
  code: string;
};

export function CodeBlock({
  samples,
  title,
}: {
  samples: CodeSample[];
  title?: string;
}) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = samples[active] ?? samples[0];

  async function copy() {
    if (!current) return;
    await navigator.clipboard.writeText(current.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#111113] shadow-sm">
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {title ? <span className="mr-2 hidden px-2 text-[11px] text-zinc-500 sm:inline">{title}</span> : null}
          {samples.length > 1
            ? samples.map((sample, index) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => setActive(index)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide",
                    index === active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {sample.label}
                </button>
              ))
            : samples[0]
              ? <span className="px-2 text-[11px] font-semibold tracking-wide text-zinc-400">{samples[0].label}</span>
              : null}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[28rem] overflow-auto p-4 text-[12.5px] leading-6 text-zinc-100">
        <code>{current?.code}</code>
      </pre>
    </div>
  );
}
