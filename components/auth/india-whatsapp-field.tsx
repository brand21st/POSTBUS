"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { IndiaFlag } from "@/components/ui/india-flag";
import { Label } from "@/components/ui/label";
import { indiaMobileInputDigits } from "@/lib/phone/india-whatsapp";
import { cn } from "@/lib/utils";

type MobileSize = "sm" | "default" | "lg";

export function IndiaMobileInput({
  id,
  name,
  value,
  onChange,
  onBlur,
  error,
  disabled,
  placeholder = "10-digit mobile number",
  size = "default",
  autoComplete = "tel-national",
}: {
  id?: string;
  name?: string;
  value?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: boolean;
  disabled?: boolean;
  placeholder?: string;
  size?: MobileSize;
  autoComplete?: string;
}) {
  const large = size === "lg";
  const compact = size === "sm";
  return (
    <div
      className={cn(
        "flex items-stretch overflow-hidden rounded-[var(--radius-input)] border border-border bg-card shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30",
        large ? "h-12" : compact ? "h-9" : "h-11",
        error && "border-error",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 border-r border-border bg-surface px-3 font-medium text-ink",
          large ? "text-base" : "text-sm"
        )}
      >
        <IndiaFlag className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgb(9_9_11/0.08)]" />
        <span>+91</span>
      </div>
      <input
        id={id}
        name={name}
        value={indiaMobileInputDigits(value ?? "")}
        onChange={(event) => onChange(indiaMobileInputDigits(event.target.value))}
        onBlur={onBlur}
        disabled={disabled}
        type="tel"
        inputMode="numeric"
        autoComplete={autoComplete}
        maxLength={10}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={cn(
          "min-w-0 flex-1 bg-transparent px-3.5 text-foreground outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:placeholder:text-zinc-500",
          large ? "text-base" : "text-sm"
        )}
      />
    </div>
  );
}

type IndiaWhatsappFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  error?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  size?: MobileSize;
  hideLabel?: boolean;
  hideError?: boolean;
};

export function IndiaWhatsappField<T extends FieldValues>({
  control,
  name,
  error,
  id = "whatsapp",
  label = "WhatsApp number",
  placeholder = "10-digit mobile number",
  size = "default",
  hideLabel = false,
  hideError = false,
}: IndiaWhatsappFieldProps<T>) {
  const large = size === "lg";
  return (
    <div className={hideLabel ? undefined : "space-y-2"}>
      {hideLabel ? null : (
        <Label htmlFor={id} className={large ? "text-sm" : undefined}>
          {label}
        </Label>
      )}
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <IndiaMobileInput
            id={id}
            name={field.name}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={Boolean(error)}
            placeholder={placeholder}
            size={size}
          />
        )}
      />
      {!hideError && error ? <p className="text-sm text-error">{error}</p> : null}
    </div>
  );
}
