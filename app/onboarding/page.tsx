"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";

const schema = z.object({
  name: z.string().min(2, "Enter a workspace name."),
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const router = useRouter();
  const me = useMe();
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.organization) {
      router.replace("/dashboard");
    }
  }, [me.data?.organization, router]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await api("/api/v1/organizations", {
        method: "POST",
        body: JSON.stringify({ name: values.name }),
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create the workspace.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[480px]">
          <div className="mb-8 flex justify-center">
            <Logo href="/" />
          </div>
          <div className="rounded-3xl border border-border bg-white p-7 shadow-[0_1px_2px_rgb(9_9_11/0.05),0_12px_40px_rgb(9_9_11/0.08)] sm:p-8 dark:bg-card">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your workspace</h1>
            <p className="mt-1.5 text-sm text-muted">
              This is the merchant account your orders, shipments, and billing will belong to.
            </p>

            <form className="mt-7 space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="name">Workspace name</Label>
                <Input
                  id="name"
                  placeholder="Northwind Retail"
                  autoComplete="organization"
                  {...form.register("name")}
                />
                {form.formState.errors.name ? (
                  <p className="text-sm text-error">{form.formState.errors.name.message}</p>
                ) : null}
              </div>

              {formError ? <p className="text-sm text-error">{formError}</p> : null}

              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Creating workspace…" : "Continue to dashboard"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
