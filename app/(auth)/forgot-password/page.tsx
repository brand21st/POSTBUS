"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const schema = z.object({
  email: z.email("Enter a valid email."),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setInfo(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      setInfo("If an account exists for that email, a reset link is on its way.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not send the reset email.");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Enter the email on your account and we will send a reset link.
      </p>

      <form className="mt-7 space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
          {form.formState.errors.email ? (
            <p className="text-sm text-error">{form.formState.errors.email.message}</p>
          ) : null}
        </div>

        {formError ? <p className="text-sm text-error">{formError}</p> : null}
        {info ? <p className="text-sm text-success">{info}</p> : null}

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
