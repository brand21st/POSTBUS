"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { IndiaMobileInput } from "@/components/auth/india-whatsapp-field";
import { OtpInput } from "@/components/auth/otp-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPlatformAdminRow } from "@/lib/admin/access";
import { ApiError, api } from "@/lib/hooks/use-api";
import { createClient } from "@/lib/supabase/client";

const SAVED_LOGIN_KEY = "postbus.login.saved-email";

const schema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

type FormValues = z.infer<typeof schema>;

type OtpSent = {
  status: "sent";
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

type OtpVerified = { status: "authenticated" } | { status: "complete_profile"; challengeId: string };

function authQueryError(code: string | null) {
  if (code === "auth_callback_failed") {
    return "That confirmation link could not be verified. Sign in, or open the latest email we sent.";
  }
  if (code === "auth_callback_missing") {
    return "The confirmation link was incomplete. Open the latest email we sent.";
  }
  return null;
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}

async function continueAfterSession(next: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = (user?.email ?? "").trim().toLowerCase();
  let isAdmin = user ? await hasPlatformAdminRow(supabase, user.id, email) : false;
  if (!isAdmin) {
    const probe = await fetch("/api/admin/overview", { credentials: "same-origin" });
    isAdmin = probe.ok;
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
  const [showPassword, setShowPassword] = useState(false);
  const [savePassword, setSavePassword] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    const savedEmail = window.localStorage.getItem(SAVED_LOGIN_KEY);
    if (!savedEmail) return;
    form.setValue("email", savedEmail);
    setSavePassword(true);
  }, [form]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      if (savePassword) window.localStorage.setItem(SAVED_LOGIN_KEY, values.email);
      else window.localStorage.removeItem(SAVED_LOGIN_KEY);
      const dest = await continueAfterSession(next);
      if (!dest) return;
      router.replace(dest);
      router.refresh();
    } catch (error) {
      setFormError(messageOf(error, "Could not sign in."));
    }
  }

  return (
    <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? (
          <p className="text-sm text-error">{form.formState.errors.email.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete={savePassword ? "current-password" : "off"}
            className="pr-11"
            {...form.register("password")}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-foreground">
          <Checkbox
            checked={savePassword}
            onCheckedChange={(value) => setSavePassword(value === true)}
            aria-label="Save password"
          />
          Save password
        </label>
        {form.formState.errors.password ? (
          <p className="text-sm text-error">{form.formState.errors.password.message}</p>
        ) : null}
      </div>
      {formError ? <p className="text-sm text-error">{formError}</p> : null}
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
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
          <div className="space-y-2">
            <Label htmlFor="whatsapp">WhatsApp number</Label>
            <IndiaMobileInput id="whatsapp" value={phone} onChange={setPhone} />
          </div>
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy || phone.length < 10}>
            {busy ? "Sending code…" : "Send OTP"}
          </Button>
        </form>
      ) : null}

      {step === "code" ? (
        <div className="space-y-5">
          <OtpInput value={otp} onChange={setOtp} onComplete={(code) => void verifyCode(code)} disabled={busy} />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="text-muted hover:text-foreground" onClick={() => setStep("phone")}>
              Change number
            </button>
            <button
              type="button"
              className="font-medium text-brand disabled:text-muted"
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
            <Input id="otp-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="otp-business">Business name</Label>
            <Input id="otp-business" value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="otp-email">Email</Label>
            <Input id="otp-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </div>
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Continue"}
          </Button>
        </form>
      ) : null}

      <div className="border-t border-border pt-4">
        <button
          type="button"
          className="text-sm font-medium text-brand hover:underline"
          onClick={() => setPasswordOpen((open) => !open)}
        >
          Sign in with email and password
        </button>
        {passwordOpen ? (
          <div className="mt-4">
            <PasswordFields next={next} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LoginForm({ otpEnabled = false }: { otpEnabled?: boolean }) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const queryError = authQueryError(searchParams.get("error"));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">
        {otpEnabled ? "Sign in with WhatsApp, or use your email and password." : "Sign in to your PostBus workspace."}
      </p>
      {queryError ? <p className="mt-4 text-sm text-error">{queryError}</p> : null}
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
