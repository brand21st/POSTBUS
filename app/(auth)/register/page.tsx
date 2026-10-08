"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { IndiaWhatsappField } from "@/components/auth/india-whatsapp-field";
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

export default function RegisterPage() {
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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        3-day trial with every PostBus feature unlocked. Connect your India Post Customer ID, then
        add Shopify or manual orders.
      </p>

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

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
