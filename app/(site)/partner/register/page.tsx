"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Field } from "@/components/affiliates/partner-portal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";

export default function Page() {
  const mutation = useMutation({
    mutationFn: (data: Record<string, FormDataEntryValue>) => api<{ message?: string }>("/api/partner/register", { method: "POST", body: JSON.stringify(data) }),
    retry: false,
  });
  return (
    <main id="main-content" className="mx-auto w-full max-w-lg p-8">
      <Card className="space-y-5 p-6">
        <h1 className="text-2xl font-semibold">Join PostBus Partners</h1>
        <p>Create a PostBus account, confirm the email, then submit your partner application. If you already have an account, sign in instead.</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(Object.fromEntries(new FormData(event.currentTarget))); }}>
          <Field name="name" label="Full name" />
          <Field name="email" label="Email" type="email" />
          <Field name="password" label="Password" type="password" />
          <Button disabled={mutation.isPending}>{mutation.isPending ? "Creating account…" : "Create account"}</Button>
        </form>
        <p role="status">{mutation.error?.message || mutation.data?.message}</p>
        <p className="text-sm"><Link className="underline" href="/partner/login">Already registered? Sign in</Link></p>
        <p className="text-sm"><Link className="underline" href="/forgot-password">Reset password</Link></p>
      </Card>
    </main>
  );
}
