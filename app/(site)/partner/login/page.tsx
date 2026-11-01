"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Field } from "@/components/affiliates/partner-portal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/hooks/use-api";

export default function PartnerLoginPage() {
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: (data: Record<string, FormDataEntryValue>) => api("/api/partner/register", { method: "PUT", body: JSON.stringify(data) }),
    retry: false,
    onSuccess: () => router.push("/partner/dashboard"),
  });
  return (
    <main id="main-content" className="mx-auto w-full max-w-lg p-8">
      <Card className="space-y-5 p-6">
        <h1 className="text-2xl font-semibold">Partner sign in</h1>
        <p className="text-sm text-muted">Sign in with your existing PostBus account. A merchant login and a partner login are the same identity.</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(Object.fromEntries(new FormData(event.currentTarget))); }}>
          <Field name="email" label="Email" type="email" />
          <Field name="password" label="Password" type="password" />
          <Button disabled={mutation.isPending}>{mutation.isPending ? "Signing in…" : "Sign in"}</Button>
        </form>
        {mutation.error ? <p role="alert">{mutation.error.message}</p> : null}
        <p className="text-sm"><Link className="underline" href="/forgot-password">Reset password</Link></p>
        <p className="text-sm"><Link className="underline" href="/partner/register">Create an account</Link></p>
      </Card>
    </main>
  );
}
