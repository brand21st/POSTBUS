"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const GROUPS = [
  {
    title: "Getting started",
    items: [
      { href: "/developers", label: "Introduction" },
      { href: "/developers/quickstart", label: "Quick start" },
      { href: "/developers/authentication", label: "Authentication" },
    ],
  },
  {
    title: "API",
    items: [
      { href: "/developers/api-reference", label: "API reference" },
      { href: "/developers/orders", label: "Orders" },
      { href: "/developers/shipments", label: "Booking & labels" },
      { href: "/developers/tracking", label: "Tracking" },
      { href: "/developers/webhooks", label: "Webhooks" },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/developers/integrations", label: "Integration guides" },
      { href: "/developers/build-with-ai", label: "Build with AI" },
      { href: "/developers/changelog", label: "Changelog" },
    ],
  },
];

const FLAT = GROUPS.flatMap((group) => group.items);

function isActive(pathname: string, href: string) {
  if (href === "/developers") return pathname === "/developers";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DevelopersNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="space-y-6">
      <label className="block lg:hidden">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Docs
        </span>
        <select
          className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-ink"
          value={FLAT.find((item) => isActive(pathname, item.href))?.href ?? "/developers"}
          onChange={(event) => router.push(event.target.value)}
        >
          {FLAT.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <nav className="hidden lg:block" aria-label="Developer documentation">
        {GROUPS.map((group) => (
          <div key={group.title} className="mb-6">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-lg px-3 py-1.5 text-sm transition",
                        active
                          ? "bg-rose-50 font-semibold text-brand"
                          : "text-zinc-600 hover:bg-white hover:text-ink"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="border-t border-border pt-4">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Spec</p>
          <a
            href="/developers/openapi.json"
            className="block rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-white hover:text-ink"
          >
            openapi.json
          </a>
          <a
            href="/developers/openapi.yaml"
            className="block rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-white hover:text-ink"
          >
            openapi.yaml
          </a>
        </div>
      </nav>
    </div>
  );
}
