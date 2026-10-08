"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

  function write(next: string) {
    const cleaned = next.replace(/\D/g, "").slice(0, 6);
    onChange(cleaned);
    if (cleaned.length === 6) onComplete?.(cleaned);
  }

  return (
    <div className="flex justify-between gap-2" onPaste={(event) => {
      const text = event.clipboardData.getData("text");
      if (!/\d/.test(text)) return;
      event.preventDefault();
      write(text);
      refs.current[Math.min(5, text.replace(/\D/g, "").length)]?.focus();
    }}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${index + 1}`}
          maxLength={1}
          className={cn(
            "h-12 w-11 rounded-[var(--radius-input)] border border-border bg-card text-center text-lg font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30",
            disabled && "opacity-50"
          )}
          onChange={(event) => {
            const entered = event.target.value.replace(/\D/g, "");
            if (entered.length > 1) {
              write(`${value.slice(0, index)}${entered}`);
              return;
            }
            const next = `${value.slice(0, index)}${entered}${value.slice(index + 1)}`.replace(/\D/g, "").slice(0, 6);
            write(next);
            if (entered && index < 5) refs.current[index + 1]?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) {
              refs.current[index - 1]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}
