import Link from "next/link";

const LINKS = [
  { href: "/developers", label: "Introduction" },
  { href: "/developers/quickstart", label: "Quick start" },
  { href: "/developers/authentication", label: "Authentication" },
  { href: "/developers/api-reference", label: "API reference" },
  { href: "/developers/orders", label: "Orders" },
  { href: "/developers/shipments", label: "Shipments" },
  { href: "/developers/tracking", label: "Tracking" },
  { href: "/developers/webhooks", label: "Webhooks" },
  { href: "/developers/integrations", label: "Integrations" },
  { href: "/developers/build-with-ai", label: "Build with AI" },
  { href: "/developers/changelog", label: "Changelog" },
];

export function DevelopersNav() {
  return (
    <nav className="space-y-1 text-sm">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="block rounded-md px-3 py-2 text-ink hover:bg-surface-soft">
          {link.label}
        </Link>
      ))}
      <a href="/developers/openapi.json" className="block rounded-md px-3 py-2 text-muted hover:bg-surface-soft">
        openapi.json
      </a>
      <a href="/developers/openapi.yaml" className="block rounded-md px-3 py-2 text-muted hover:bg-surface-soft">
        openapi.yaml
      </a>
    </nav>
  );
}
