"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { navLinks, siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const mobilePanelRef = React.useRef<HTMLDivElement>(null);

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

  React.useEffect(() => {
    if (!open) return;
    const focusable = mobilePanelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key === "Tab" && focusable?.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const closeMenu = React.useCallback(() => setOpen(false), []);

  const isActive = (href: string) => {
    if (href.startsWith("/#")) return pathname === "/";
    return pathname === href;
  };

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
          <Logo priority />

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                  "rounded-lg px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-ink",
                  isActive(link.href) && "font-semibold text-brand"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Link
              href={siteConfig.loginUrl}
              className="px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Login
            </Link>
            <Link
              href={siteConfig.getStartedUrl}
              className={cn(
                buttonVariants({ variant: "primary", size: "default" }),
                "group rounded-full shadow-sm hover:shadow"
              )}
            >
              Start Free Trial
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>

      {open ? (
        <div
          ref={mobilePanelRef}
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
          className="border-t border-border bg-white lg:hidden"
        >
          <Container>
            <nav className="flex flex-col gap-1 py-4" aria-label="Mobile">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="border-b border-border/70 px-1 py-3 text-base font-semibold text-ink last:border-0"
                  onClick={closeMenu}
                >
                  {link.label}
                </Link>
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
                  className={cn(
                    buttonVariants({ variant: "primary", size: "lg" }),
                    "w-full rounded-full"
                  )}
                  onClick={closeMenu}
                >
                  Start Free Trial
                </Link>
              </div>
            </nav>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
