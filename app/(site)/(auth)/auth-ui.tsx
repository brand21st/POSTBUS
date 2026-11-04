"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 16px text on phones stops iOS Safari from zooming into a field on focus. */
export const AUTH_INPUT_CLASS = "text-base sm:text-sm";

export function fieldErrorId(id: string) {
  return `${id}-error`;
}

/** aria wiring so a screen reader announces the field's error when it is focused. */
export function fieldA11y(id: string, error?: string, hintId?: string) {
  const describedBy = [error ? fieldErrorId(id) : null, hintId].filter(Boolean).join(" ");
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={fieldErrorId(id)} className="flex items-start gap-1.5 text-sm text-error">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

export function FormAlert({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success";
}) {
  if (!children) return null;
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        tone === "error"
          ? "border-error/25 bg-error/5 text-error"
          : "border-success/25 bg-success/5 text-success"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </div>
  );
}

export function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
}: {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending || disabled} aria-busy={pending || undefined}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-11", AUTH_INPUT_CLASS, className)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-input)] text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={props.id}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    );
  }
);

/** Supabase auth errors are terse and technical; say what happened and what to do next. */
export function friendlyAuthError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) {
    return "That email and password don't match. Check them, or reset your password.";
  }
  if (text.includes("email not confirmed")) {
    return "Confirm your email first. Open the link we sent when you signed up, then sign in.";
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return "Can't reach PostBus. Check your connection and try again.";
  }
  return message;
}
