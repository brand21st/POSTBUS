"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { IndiaMobileInput } from "@/components/auth/india-whatsapp-field";
import { OtpInput } from "@/components/auth/otp-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPlatformAdminRow } from "@/lib/admin/access";
import { safeAuthNext } from "@/lib/auth/safe-next";
import { ApiError, api } from "@/lib/hooks/use-api";
import { createClient } from "@/lib/supabase/client";
import {
  AUTH_INPUT_CLASS,
  FieldError,
  FormAlert,
  PasswordInput,
  SubmitButton,
  fieldA11y,
  friendlyAuthError,
} from "../auth-ui";

const SAVED_LOGIN_KEY = "postbus.login.saved-email";
const ADMIN_PROBE_TIMEOUT_MS = 5000;

const schema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(1, "Enter your password."),
});

type FormInput = z.input<typeof schema>;
type FormValues = z.output<typeof schema>;

type OtpSent = {
  status: "sent";
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

type OtpVerified = { status: "authenticated" } | { status: "complete_profile"; challengeId: string };

function authQueryError(code: string | null) {
  if (code === "auth_callback_failed") {
    return "That confirmation link could not be verified. It may have expired or already been used. Sign in, or open the latest email we sent.";
  }
  if (code === "auth_callback_missing") {
    return "The confirmation link was incomplete. Open the latest email we sent.";
  }
  return null;
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}

const noSubscribe = () => () => {};

function readSavedEmail() {
  try {
    return window.localStorage.getItem(SAVED_LOGIN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSavedEmail(email: string | null) {
  try {
    if (email) window.localStorage.setItem(SAVED_LOGIN_KEY, email);
    else window.localStorage.removeItem(SAVED_LOGIN_KEY);
  } catch {
    // Private mode / blocked storage: remembering the email is a convenience, not required.
  }
}

async function continueAfterSession(next: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = (user?.email ?? "").trim().toLowerCase();
  let isAdmin = user ? await hasPlatformAdminRow(supabase, user.id, email) : false;
  if (!isAdmin) {
    // Merchants hit this probe on every sign-in. A slow or failing admin route must not hold
    // the session on "Signing in…", so give up after a few seconds and treat it as not admin.
    try {
      const probe = await fetch("/api/admin/overview", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(ADMIN_PROBE_TIMEOUT_MS),
      });
      isAdmin = probe.ok;
    } catch {
      isAdmin = false;
    }
  }
  const dest = isAdmin ? (next.startsWith("/admin") ? next : "/admin") : next;
  if (dest.startsWith("/admin")) {
    window.location.assign(dest);
    return;
  }
  return dest;
}

function PasswordFields({ next }: { next: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // localStorage only exists in the browser; the server snapshot ("") keeps hydration in sync.
  const savedEmail = useSyncExternalStore(noSubscribe, readSavedEmail, () => "");
  const [rememberChoice, setRememberEmail] = useState<boolean | null>(null);
  const rememberEmail = rememberChoice ?? Boolean(savedEmail);
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });
  const errors = form.formState.errors;
  // isSubmitting drops back to false before router.replace finishes, so keep the button busy
  // until the next page takes over instead of letting it flash back to "Sign in".
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!savedEmail || form.getValues("email")) return;
    form.setValue("email", savedEmail);
    form.setFocus("password");
  }, [form, savedEmail]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        setFormError(friendlyAuthError(error.message));
        return;
      }
      writeSavedEmail(rememberEmail ? values.email : null);
      setRedirecting(true);
      const dest = await continueAfterSession(next);
      if (!dest) return;
      router.replace(dest);
      router.refresh();
    } catch (error) {
      setRedirecting(false);
      setFormError(friendlyAuthError(messageOf(error, "Could not sign in. Try again.")));
    }
  }

  const pending = form.formState.isSubmitting || redirecting;

  return (
    <form className="space-y-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <FormAlert>{formError}</FormAlert>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@business.com"
          className={AUTH_INPUT_CLASS}
          {...fieldA11y("email", errors.email?.message)}
          {...form.register("email")}
        />
        <FieldError id="email" message={errors.email?.message} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="rounded text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          {...fieldA11y("password", errors.password?.message)}
          {...form.register("password")}
        />
        <FieldError id="password" message={errors.password?.message} />
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2.5 py-1 text-sm text-foreground">
        <Checkbox checked={rememberEmail} onCheckedChange={(value) => setRememberEmail(value === true)} />
        Remember my email on this device
      </label>
      <SubmitButton pending={pending} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}

function WhatsappLogin({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code" | "profile">("phone");
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function finish(result: OtpVerified) {
    if (result.status === "complete_profile") {
      setChallengeId(result.challengeId);
      setStep("profile");
      setError(null);
      return;
    }
    const dest = await continueAfterSession(next);
    if (!dest) return;
    router.replace(dest);
    router.refresh();
  }

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const result = await api<OtpSent>("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, purpose: "LOGIN" }),
      });
      setChallengeId(result.challengeId);
      setOtp("");
      setResendAt(Date.now() + result.resendAfterSeconds * 1000);
      setStep("code");
    } catch (caught) {
      setError(messageOf(caught, "Could not send a code. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(code: string) {
    setError(null);
    setBusy(true);
    try {
      const result = await api<OtpVerified>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_id: challengeId, phone, purpose: "LOGIN", otp: code }),
      });
      await finish(result);
    } catch (caught) {
      setError(messageOf(caught, "Invalid or expired OTP."));
    } finally {
      setBusy(false);
    }
  }

  async function completeProfile() {
    setError(null);
    setBusy(true);
    try {
      const result = await api<OtpVerified>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({
          challenge_id: challengeId,
          phone,
          purpose: "LOGIN",
          profile: { name, business_name: businessName, email },
        }),
      });
      await finish(result);
    } catch (caught) {
      setError(messageOf(caught, "Could not sign you in. Request a new code."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {step === "phone" ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode();
          }}
        >
          <FormAlert>{error}</FormAlert>
          <div className="space-y-2">
            <Label htmlFor="whatsapp">WhatsApp number</Label>
            <IndiaMobileInput id="whatsapp" value={phone} onChange={setPhone} />
          </div>
          <SubmitButton pending={busy} pendingLabel="Sending code…" disabled={phone.length < 10}>
            Send OTP
          </SubmitButton>
        </form>
      ) : null}

      {step === "code" ? (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Enter the 6-digit code we sent on WhatsApp to <span className="font-medium text-ink">+91 {phone}</span>.
          </p>
          <OtpInput value={otp} onChange={setOtp} onComplete={(code) => void verifyCode(code)} disabled={busy} />
          <FormAlert>{error}</FormAlert>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="min-h-11 text-muted hover:text-foreground" onClick={() => setStep("phone")}>
              Change number
            </button>
            <button
              type="button"
              className="min-h-11 font-medium text-brand disabled:text-muted"
              disabled={busy || waitSeconds > 0}
              onClick={() => void sendCode()}
            >
              {waitSeconds > 0 ? `Resend in ${waitSeconds}s` : "Resend code"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "profile" ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void completeProfile();
          }}
        >
          <p className="text-sm text-muted">Tell us about your business to finish signing in.</p>
          <div className="space-y-2">
            <Label htmlFor="otp-name">Name</Label>
            <Input id="otp-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className={AUTH_INPUT_CLASS} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="otp-business">Business name</Label>
            <Input id="otp-business" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" className={AUTH_INPUT_CLASS} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="otp-email">Email</Label>
            <Input id="otp-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={AUTH_INPUT_CLASS} />
          </div>
          <FormAlert>{error}</FormAlert>
          <SubmitButton pending={busy} pendingLabel="Signing in…">
            Continue
          </SubmitButton>
        </form>
      ) : null}

      <div className="border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          className="h-auto px-0 py-1 text-sm font-medium text-brand hover:bg-transparent hover:underline"
          aria-expanded={passwordOpen}
          onClick={() => setPasswordOpen((open) => !open)}
        >
          Sign in with email and password
        </Button>
        {passwordOpen ? (
          <div className="mt-4">
            <PasswordFields next={next} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LoginForm({
  otpEnabled = false,
  next: rawNext = "/dashboard",
  errorCode = null,
}: {
  otpEnabled?: boolean;
  next?: string;
  errorCode?: string | null;
}) {
  const next = safeAuthNext(rawNext);
  const queryError = authQueryError(errorCode);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">
        {otpEnabled ? "Sign in with WhatsApp, or use your email and password." : "Sign in to your PostBus workspace."}
      </p>
      {queryError ? (
        <div className="mt-5">
          <FormAlert>{queryError}</FormAlert>
        </div>
      ) : null}
      <div className="mt-7">
        {otpEnabled ? <WhatsappLogin next={next} /> : <PasswordFields next={next} />}
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        New to PostBus?{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
