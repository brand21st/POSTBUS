"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const intents = [
  { value: "start", label: "Get Started" },
  { value: "demo", label: "Book a Demo" },
  { value: "login", label: "Account / Login" },
  { value: "general", label: "General inquiry" },
] as const;

export function ContactForm() {
  const searchParams = useSearchParams();
  const intentFromUrl = searchParams.get("intent") ?? "start";
  const plan = searchParams.get("plan");

  const [selectedIntent, setSelectedIntent] = React.useState<string | null>(null);
  const intent = selectedIntent ?? intentFromUrl;
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [storeUrl, setStoreUrl] = React.useState("");
  const [message, setMessage] = React.useState(
    plan ? `Interested in the ${plan} plan.` : ""
  );
  const [submitted, setSubmitted] = React.useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const intentLabel =
      intents.find((item) => item.value === intent)?.label ?? "Inquiry";
    const subject = encodeURIComponent(`PostBus — ${intentLabel}`);
    const body = encodeURIComponent(
      [
        `Name: ${name}`,
        `Email: ${email}`,
        `Store URL: ${storeUrl || "Not provided"}`,
        `Intent: ${intentLabel}`,
        "",
        message || "No additional message.",
      ].join("\n")
    );
    window.location.href = `mailto:${siteConfig.contactEmail}?subject=${subject}&body=${body}`;
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-[28px] border border-border bg-white p-8 text-center card-shadow">
        <CheckCircle2 className="mx-auto size-10 text-brand" />
        <h2 className="mt-4 text-xl font-semibold text-ink">Opening your email client</h2>
        <p className="mt-2 text-sm text-muted">
          If nothing opens, write to{" "}
          <a className="font-medium text-brand" href={`mailto:${siteConfig.contactEmail}`}>
            {siteConfig.contactEmail}
          </a>
          .
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => setSubmitted(false)}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[28px] border border-border bg-white p-6 card-shadow sm:p-8"
    >
      <div className="grid gap-5">
        <Field label="What can we help with?">
          <div className="grid gap-2 sm:grid-cols-2">
            {intents.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSelectedIntent(item.value)}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  intent === item.value
                    ? "border-brand bg-brand/5 text-brand"
                    : "border-border text-muted hover:border-zinc-300 hover:text-ink"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Name" htmlFor="name">
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
            placeholder="Your name"
            autoComplete="name"
          />
        </Field>

        <Field label="Work email" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="you@company.com"
            autoComplete="email"
          />
        </Field>

        <Field label="Shopify store URL" htmlFor="store">
          <input
            id="store"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            className="input-field"
            placeholder="https://your-store.myshopify.com"
            autoComplete="url"
          />
        </Field>

        <Field label="Message" htmlFor="message">
          <textarea
            id="message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="input-field resize-y"
            placeholder="Tell us about your shipping volume and workflow."
          />
        </Field>
      </div>

      <Button type="submit" size="lg" className="group mt-6 w-full">
        Send message
        <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        Submits via email to {siteConfig.contactEmail}. No account is created on this site.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}
