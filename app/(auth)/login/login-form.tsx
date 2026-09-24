"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const SAVED_LOGIN_KEY = "postbus.login.saved-email";

const schema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

type FormValues = z.infer<typeof schema>;

function authQueryError(code: string | null) {
  if (code === "auth_callback_failed") {
    return "That confirmation link could not be verified. Sign in, or open the latest email we sent.";
  }
  if (code === "auth_callback_missing") {
    return "The confirmation link was incomplete. Open the latest email we sent.";
  }
  return null;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [formError, setFormError] = useState<string | null>(() =>
    authQueryError(searchParams.get("error"))
  );
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
      if (savePassword) {
        window.localStorage.setItem(SAVED_LOGIN_KEY, values.email);
      } else {
        window.localStorage.removeItem(SAVED_LOGIN_KEY);
      }
      let dest = next;
      if (!searchParams.get("next") || next === "/dashboard") {
        const admin = await fetch("/api/admin/overview", { credentials: "same-origin" });
        if (admin.ok) dest = "/admin";
      }
      router.replace(dest);
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">Sign in to your PostBus workspace.</p>

      <form className="mt-7 space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
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

      <p className="mt-6 text-center text-sm text-muted">
        New to PostBus?{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
