"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
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

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function PasswordRegister() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<RegisterAccountInput, unknown, RegisterAccountValues>({
    resolver: zodResolver(registerAccountSchema),
    defaultValues: { name: "", email: "", password: "", whatsapp: "", pincode: "", city: "" },
  });

  async function onSubmit(values: RegisterAccountValues) {
    setFormError(null);
    setInfo(null);
    try {
      const result = await api<RegisterResult>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(values),
      });
      if (result.needsEmailConfirmation) {
        setInfo(
          "Check your email and click the confirmation link. After it is verified you will land on your dashboard."
        );
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "Could not create your account.");
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" autoComplete="name" {...form.register("name")} />
        {form.formState.errors.name ? (
          <p className="text-sm text-error">{form.formState.errors.name.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? (
          <p className="text-sm text-error">{form.formState.errors.email.message}</p>
        ) : null}
      </div>
      <IndiaWhatsappField
        control={form.control}
        name="whatsapp"
        error={form.formState.errors.whatsapp?.message}
      />
      <div className="space-y-2">
        <Label htmlFor="pincode">PIN code</Label>
        <Input
          id="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          {...form.register("pincode", {
            onChange: (event) => {
              const digits = String(event.target.value ?? "")
                .replace(/\D/g, "")
                .slice(0, 6);
              form.setValue("pincode", digits, { shouldDirty: true, shouldValidate: digits.length === 6 });
            },
          })}
        />
        <RegisterPincodeLookup form={form} />
        {form.formState.errors.pincode ? (
          <p className="text-sm text-error">{form.formState.errors.pincode.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="city">City</Label>
        <Input id="city" autoComplete="address-level2" {...form.register("city")} />
        {form.formState.errors.city ? (
          <p className="text-sm text-error">{form.formState.errors.city.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
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
        {form.formState.errors.password ? (
          <p className="text-sm text-error">{form.formState.errors.password.message}</p>
        ) : null}
      </div>
      {formError ? <p className="text-sm text-error">{formError}</p> : null}
      {info ? <p className="text-sm text-success">{info}</p> : null}
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Creating account…" : "Create account"}
      </Button>
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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

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
        <OtpInput value={otp} onChange={setOtp} onComplete={(code) => void verifyCode(code)} disabled={busy} />
        {error ? <p className="text-sm text-error">{error}</p> : null}
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="text-muted hover:text-foreground" onClick={() => setStep("details")}>
            Edit details
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
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="business">Business name</Label>
        <Input id="business" value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="whatsapp">WhatsApp number</Label>
        <IndiaMobileInput id="whatsapp" value={phone} onChange={setPhone} />
      </div>
      {error ? <p className="text-sm text-error">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Sending code…" : "Send OTP"}
      </Button>
    </form>
  );
}

export function RegisterForm({ otpEnabled = false }: { otpEnabled?: boolean }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        3-day trial with every PostBus feature unlocked. Connect your India Post Customer ID, then
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
