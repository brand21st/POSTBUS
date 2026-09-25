import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { Container } from "@/components/ui/container";
import { footerLinks, siteConfig } from "@/lib/site-config";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-ink text-white">
      <Container className="py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Logo light showTagline />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-zinc-400">
              India Post shipping management for ecommerce. Connect your existing Customer ID and
              run booking, labels, tracking and invoices from one dashboard.
            </p>
            <p className="mt-6 text-sm font-medium text-zinc-300">
              {siteConfig.url.replace("https://", "")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <FooterColumn title="Product" links={footerLinks.product} />
            <FooterColumn title="Company" links={footerLinks.company} />
            <FooterColumn title="Legal" links={footerLinks.legal} />
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 PostBus. All rights reserved.</p>
          <p>Independent software. Not affiliated with India Post.</p>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { label: string; href: string }[];
}) {
  return (
    <div>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {title}
      </h3>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="text-sm text-zinc-300 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
