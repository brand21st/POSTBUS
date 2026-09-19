"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { navLinks, siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [openDropdown, setOpenDropdown] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const closeMenu = React.useCallback(() => {
    setOpen(false);
    setOpenDropdown(null);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "border-b border-border/80 bg-white/85 backdrop-blur-xl"
          : "border-b border-transparent bg-white/60 backdrop-blur-md"
      )}
    >
      <Container>
        <div className="flex h-16 items-center justify-between gap-4 lg:h-[72px]">
          <Logo />

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {navLinks.map((link) =>
              "children" in link && link.children ? (
                <div
                  key={link.label}
                  className="relative"
                  onMouseEnter={() => setOpenDropdown(link.label)}
                  onMouseLeave={() => setOpenDropdown(null)}
                >
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-ink",
                      openDropdown === link.label && "text-ink"
                    )}
                    aria-expanded={openDropdown === link.label}
                  >
                    {link.label}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </button>
                  {openDropdown === link.label ? (
                    <div className="absolute left-0 top-full pt-2">
                      <div className="min-w-[200px] rounded-2xl border border-border bg-white p-2 card-shadow-lg">
                        {link.children.map((child) => (
                          <Link
                            key={child.label}
                            href={child.href}
                            onClick={closeMenu}
                            className="block rounded-xl px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-soft hover:text-brand"
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Link
                  key={link.label}
                  href={link.href}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-ink",
                    pathname === link.href && "text-brand"
                  )}
                >
                  {link.label}
                </Link>
              )
            )}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <Link
              href={siteConfig.loginUrl}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Login
            </Link>
            <Link
              href={siteConfig.getStartedUrl}
              className={cn(buttonVariants({ variant: "primary", size: "default" }), "group")}
            >
              Get Started
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>

      {open ? (
        <div className="border-t border-border bg-white lg:hidden">
          <Container>
            <nav className="flex flex-col gap-1 py-4" aria-label="Mobile">
              {navLinks.map((link) => (
                <div key={link.label} className="border-b border-border/70 py-2 last:border-0">
                  <Link
                    href={link.href}
                    className="block px-1 py-2 text-base font-semibold text-ink"
                    onClick={closeMenu}
                  >
                    {link.label}
                  </Link>
                  {"children" in link && link.children ? (
                    <div className="mb-2 ml-3 flex flex-col gap-1">
                      {link.children.map((child) => (
                        <Link
                          key={child.label}
                          href={child.href}
                          className="rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-soft hover:text-ink"
                          onClick={closeMenu}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href={siteConfig.loginUrl}
                  className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}
                  onClick={closeMenu}
                >
                  Login
                </Link>
                <Link
                  href={siteConfig.getStartedUrl}
                  className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
                  onClick={closeMenu}
                >
                  Get Started
                </Link>
              </div>
            </nav>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
