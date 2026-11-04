"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { IndiaMobileInput, IndiaWhatsappField } from "@/components/auth/india-whatsapp-field";
import { OtpInput } from "@/components/auth/otp-input";
import { RegisterPincodeLookup } from "@/components/auth/register-pincode-lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerAccountSchema,
  type RegisterAccountInput,
  type RegisterAccountValues,
} from "@/lib/auth/register-schema";
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

type RegisterResult = {
  userId: string | null;
  needsEmailConfirmation: boolean;
  whatsappNumber: string;
};

type OtpSent = {
  status: "sent";
  challengeId: string;
  resendAfterSeconds: number;
};

const RESEND_COOLDOWN_SECONDS = 60;

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

function CheckInbox({ email, onEdit }: { email: string; onEdit: () => void }) {
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const wait = useCountdown(resendAt);

  async function resend() {
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fdashboard` },
      });
      if (error) throw error;
      setNotice({ tone: "success", text: "Sent again. It can take a minute to arrive." });
      setResendAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    } catch (caught) {
      setNotice({
        tone: "error",
        text: friendlyAuthError(caught instanceof Error ? caught.message : "Could not resend. Try again shortly."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-7 space-y-5 text-center" role="status">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand">
        <MailCheck className="size-7" aria-hidden />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">Check your inbox</h2>
        <p className="text-sm text-muted">
          We sent a confirmation link to <span className="break-all font-medium text-ink">{email}</span>. Open it to
          verify your email and go straight to your dashboard.
        </p>
        <p className="text-xs text-muted">Not there? Check Spam or Promotions.</p>
      </div>
      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
      <div className="flex flex-col gap-2.5">
        <Button type="button" variant="outline" className="h-11 w-full" disabled={busy || wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Resend email in ${wait}s` : busy ? "Sending…" : "Resend email"}
        </Button>
        <button type="button" className="min-h-11 text-sm font-medium text-muted hover:text-foreground" onClick={onEdit}>
          Wrong email? Edit details
        </button>
      </div>
    </div>
  );
}

function PasswordRegister() {
  const router = useRouter();
  const [formError, setFormError] = useState<{ text: string; existing: boolean } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const form = useForm<RegisterAccountInput, unknown, RegisterAccountValues>({
    resolver: zodResolver(registerAccountSchema),
    mode: "onTouched",
    defaultValues: { name: "", email: "", password: "", whatsapp: "", pincode: "", city: "" },
  });
  const errors = form.formState.errors;
  const pincodeValue = form.watch("pincode");
  const cityValue = form.watch("city");
  const lookingUpCity = /^[1-9][0-9]{5}$/.test(String(pincodeValue ?? "")) && !String(cityValue ?? "").trim();

  async function onSubmit(values: RegisterAccountValues) {
    setFormError(null);
    try {
      const result = await api<RegisterResult>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(values),
      });
      if (result.needsEmailConfirmation) {
        setSentTo(values.email);
        return;
      }
      setRedirecting(true);
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      const existing = error instanceof ApiError && error.status === 409;
      setFormError({
        text: error instanceof ApiError ? error.message : "Could not create your account. Check your connection and try again.",
        existing,
      });
      if (existing) form.setFocus("email");
    }
  }

  if (sentTo) {
    return <CheckInbox email={sentTo} onEdit={() => setSentTo(null)} />;
  }

  return (
    <form className="mt-7 space-y-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      {formError ? (
        <FormAlert>
          {formError.text}
          {formError.existing ? (
            <span className="mt-1 block">
              <Link href="/login">Sign in</Link> or <Link href="/forgot-password">reset your password</Link>.
            </span>
          ) : null}
        </FormAlert>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          autoComplete="name"
          autoCapitalize="words"
          className={AUTH_INPUT_CLASS}
          {...fieldA11y("name", errors.name?.message)}
          {...form.register("name")}
        />
        <FieldError id="name" message={errors.name?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@business.com"
          className={AUTH_INPUT_CLASS}
          {...fieldA11y("email", errors.email?.message)}
          {...form.register("email")}
        />
        <FieldError id="email" message={errors.email?.message} />
      </div>
      <IndiaWhatsappField control={form.control} name="whatsapp" error={errors.whatsapp?.message} />
      <div>
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pincode">PIN code</Label>
            <Input
              id="pincode"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              placeholder="560001"
              className={AUTH_INPUT_CLASS}
              {...fieldA11y("pincode", errors.pincode?.message, "pincode-hint")}
              {...form.register("pincode", {
                onChange: (event) => {
                  const digits = String(event.target.value ?? "")
                    .replace(/\D/g, "")
                    .slice(0, 6);
                  form.setValue("pincode", digits, { shouldDirty: true, shouldValidate: false });
                  if (digits.length === 6) void form.trigger("pincode");
                },
              })}
            />
            <FieldError id="pincode" message={errors.pincode?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              autoComplete="address-level2"
              className={AUTH_INPUT_CLASS}
              placeholder={lookingUpCity ? "Looking up…" : "Bengaluru"}
              aria-busy={lookingUpCity || undefined}
              {...fieldA11y("city", errors.city?.message)}
              {...form.register("city")}
              value={cityValue}
              onChange={(event) => {
                form.setValue("city", event.target.value, { shouldDirty: true, shouldValidate: true });
              }}
            />
            <FieldError id="city" message={errors.city?.message} />
          </div>
        </div>
        <div id="pincode-hint">
          <RegisterPincodeLookup form={form} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Create a password</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          {...fieldA11y("password", errors.password?.message, errors.password ? undefined : "password-hint")}
          {...form.register("password")}
        />
        {errors.password ? (
          <FieldError id="password" message={errors.password.message} />
        ) : (
          <p id="password-hint" className="text-xs text-muted">
            At least 8 characters.
          </p>
        )}
      </div>
      <SubmitButton pending={form.formState.isSubmitting || redirecting} pendingLabel="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-center text-xs leading-relaxed text-muted">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

function WhatsappRegister() {
  const router = useRouter();
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const waitSeconds = useCountdown(resendAt);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const result = await api<OtpSent>("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({
          purpose: "SIGNUP",
          phone,
          name,
          business_name: businessName,
          email,
        }),
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
      const result = await api<{ status: string }>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_id: challengeId, phone, purpose: "SIGNUP", otp: code }),
      });
      if (result.status !== "authenticated") {
        setError("Could not sign you in. Request a new code.");
        setBusy(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught, "Invalid or expired OTP."));
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <div className="mt-7 space-y-5">
        <p className="text-sm text-muted">
          Enter the 6-digit code we sent on WhatsApp to <span className="font-medium text-ink">+91 {phone}</span>.
        </p>
        <OtpInput value={otp} onChange={setOtp} onComplete={(code) => void verifyCode(code)} disabled={busy} />
        <FormAlert>{error}</FormAlert>
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="min-h-11 text-muted hover:text-foreground" onClick={() => setStep("details")}>
            Edit details
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
    );
  }

  return (
    <form
      className="mt-7 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void sendCode();
      }}
    >
      <FormAlert>{error}</FormAlert>
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className={AUTH_INPUT_CLASS} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="business">Business name</Label>
        <Input id="business" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" className={AUTH_INPUT_CLASS} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" type="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={AUTH_INPUT_CLASS} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="whatsapp">WhatsApp number</Label>
        <IndiaMobileInput id="whatsapp" value={phone} onChange={setPhone} />
      </div>
      <SubmitButton pending={busy} pendingLabel="Sending code…" disabled={phone.length < 10}>
        Send OTP
      </SubmitButton>
    </form>
  );
}

export function RegisterForm({ otpEnabled = false }: { otpEnabled?: boolean }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        7-day trial with every PostBus feature unlocked. Connect your India Post Customer ID, then
        add Shopify or manual orders.
      </p>
      {otpEnabled ? <WhatsappRegister /> : <PasswordRegister />}
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
