"use client";

import { useState, type FocusEventHandler } from "react";
import { type Control, type FieldPath, type FieldValues, useWatch } from "react-hook-form";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { INDIA_POST_ADDRESS_LINE_MAX } from "@/modules/india-post/spec";

export const ADDRESS_LINE_REMAINING_WARN = 20;
export const INDIA_POST_ADDRESS_LINE_TOO_LONG = `Fits ${INDIA_POST_ADDRESS_LINE_MAX} characters on the India Post label.`;

export function clipIndiaPostAddressLine(value: string, max = INDIA_POST_ADDRESS_LINE_MAX) {
  return value.slice(0, max);
}

export function addressLineRemaining(length: number, max = INDIA_POST_ADDRESS_LINE_MAX) {
  return Math.max(0, max - Math.max(0, length));
}

export function shouldShowAddressLineRemaining(
  remaining: number,
  focused: boolean,
  warnAt = ADDRESS_LINE_REMAINING_WARN
) {
  return focused || remaining <= warnAt;
}

function remainingTone(remaining: number) {
  if (remaining <= 0) return "text-error";
  if (remaining <= ADDRESS_LINE_REMAINING_WARN) return "text-warning";
  return "text-muted";
}

export function AddressLineInput<T extends FieldValues>({
  id,
  label,
  hint,
  error,
  className,
  inputClassName,
  control,
  maxLength = INDIA_POST_ADDRESS_LINE_MAX,
  onFocus,
  onBlur,
  name,
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  inputClassName?: string;
  control: Control<T>;
  maxLength?: number;
} & Omit<InputProps, "id" | "maxLength"> & { name: FieldPath<T> }) {
  const [focused, setFocused] = useState(false);
  const watched = useWatch({ control, name });
  const remaining = addressLineRemaining(String(watched ?? "").length, maxLength);
  const showCount = shouldShowAddressLineRemaining(remaining, focused);
  const hintId = hint ? `${id}-hint` : undefined;
  const countId = `${id}-count`;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, showCount ? countId : undefined, errorId].filter(Boolean).join(" ") || undefined;

  const handleFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    setFocused(true);
    onFocus?.(event);
  };
  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    setFocused(false);
    onBlur?.(event);
  };

  return (
    <div className={cn("group", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <p
          id={countId}
          className={cn(
            "text-[11px] tabular-nums leading-none group-focus-within:visible",
            remainingTone(remaining),
            showCount ? "visible" : "invisible"
          )}
          aria-live="polite"
          aria-atomic="true"
          aria-hidden={!showCount}
        >
          {remaining} left
        </p>
      </div>
      <div className="mt-1">
        <Input
          {...inputProps}
          id={id}
          name={name}
          className={inputClassName}
          maxLength={maxLength}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </div>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-[11px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-0.5 text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
