"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StoreImage } from "@/components/storefront/store-image";
import type { FooterSocialNetwork, StoreFooter, StoreFooterLink } from "@/modules/storefront/footer";
import { cn } from "@/lib/utils";

function SvgIcon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" d={path} />
    </svg>
  );
}

const SOCIAL_ICONS: Record<FooterSocialNetwork, (props: { className?: string }) => ReactNode> = {
  instagram: (props) => (
    <SvgIcon
      {...props}
      path="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm10 2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-5 3.2A3.8 3.8 0 1 1 8.2 12 3.8 3.8 0 0 1 12 8.2Zm0 1.6A2.2 2.2 0 1 0 14.2 12 2.2 2.2 0 0 0 12 9.8ZM17.4 6.6a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z"
    />
  ),
  facebook: (props) => (
    <SvgIcon {...props} path="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.6l.4-3H13v-2c0-.6.4-1 1-1Z" />
  ),
  youtube: (props) => (
    <SvgIcon {...props} path="M23 12.2s0-3.1-.4-4.5c-.2-.9-.9-1.6-1.8-1.8C19.2 5.5 12 5.5 12 5.5s-7.2 0-8.8.4c-.9.2-1.6.9-1.8 1.8C1 9.1 1 12.2 1 12.2s0 3.1.4 4.5c.2.9.9 1.6 1.8 1.8 1.6.4 8.8.4 8.8.4s7.2 0 8.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.4.4-4.5.4-4.5ZM9.8 15.5v-6.6l6.2 3.3-6.2 3.3Z" />
  ),
  x: (props) => (
    <SvgIcon {...props} path="M18.244 2H21l-6.51 7.44L22 22h-6.79l-4.32-6.45L6.2 22H3.44l6.96-7.96L2 2h6.96l3.9 5.94L18.244 2Zm-1.19 18.2h1.88L7.03 3.7H5.02l12.034 16.5Z" />
  ),
  linkedin: (props) => (
    <SvgIcon {...props} path="M6.5 9H4V20h2.5V9ZM5.3 4A1.6 1.6 0 1 0 5.3 7.2 1.6 1.6 0 0 0 5.3 4ZM20 20h-2.5v-5.6c0-1.6-.6-2.6-2-2.6-1.1 0-1.7.7-2 1.4-.1.2-.1.6-.1.9V20H11s0-9.3 0-10.3h2.5v1.5c.4-.7 1.3-1.8 3.3-1.8 2.4 0 4.2 1.6 4.2 5V20Z" />
  ),
};

function FooterLink({
  item,
  className,
}: {
  item: StoreFooterLink;
  className?: string;
}) {
  if (!item.href) {
    return <span className={className}>{item.label}</span>;
  }
  const external = item.external || /^https?:/i.test(item.href);
  return (
    <Link
      href={item.href}
      className={cn(
        "inline-flex min-h-11 min-w-0 items-center rounded-lg text-sm transition-colors duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none",
        className
      )}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="break-words">{item.label}</span>
    </Link>
  );
}

function FooterColumn({ title, children, headingColor }: { title: string; children: ReactNode; headingColor: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-sm font-semibold tracking-wide" style={{ color: headingColor }}>
        {title}
      </h2>
      <div className="mt-2 flex flex-col items-start">{children}</div>
    </div>
  );
}

export function StorefrontFooter({ footer }: { footer: StoreFooter | null | undefined }) {
  if (!footer) return null;
  const { appearance } = footer;
  const year = new Date().getFullYear();
  const sections: Array<{ id: string; title: string; content: ReactNode; show: boolean }> = [
    {
      id: "shop",
      title: "Shop",
      show: footer.shop.length > 0,
      content: footer.shop.map((item) => <FooterLink key={`${item.label}-${item.href}`} item={item} />),
    },
    {
      id: "support",
      title: "Customer support",
      show: footer.support.length > 0,
      content: footer.support.map((item) => <FooterLink key={`${item.label}-${item.href}`} item={item} />),
    },
    {
      id: "policies",
      title: "Policies",
      show: footer.policies.length > 0,
      content: footer.policies.map((item) => <FooterLink key={item.href} item={item} />),
    },
    {
      id: "business",
      title: "Business information",
      show: Boolean(footer.business),
      content: footer.business ? (
        <div className="min-w-0 space-y-1 py-2 text-sm leading-relaxed">
          <p className="break-words font-medium" style={{ color: appearance.headingColor }}>
            {footer.business.name}
          </p>
          {footer.business.lines.map((line) => (
            <p key={line} className="break-words">
              {line}
            </p>
          ))}
        </div>
      ) : null,
    },
  ];
  const visible = sections.filter((section) => section.show);
  const stacked = appearance.layout === "stacked";

  return (
    <footer
      className="mt-8 w-full min-w-0 border-t"
      style={{
        backgroundColor: appearance.backgroundColor,
        color: appearance.textColor,
        borderColor: appearance.borderColor,
      }}
    >
      <div className="mx-auto w-full max-w-7xl min-w-0 px-3 py-8 sm:px-5 lg:py-12">
        <div
          className={cn(
            "grid min-w-0 gap-8",
            stacked ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
          )}
        >
          {footer.brand ? (
            <div className="min-w-0 lg:col-span-1">
              <div className="flex min-w-0 items-center gap-3">
                {footer.brand.logoUrl ? (
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-white/10">
                    <StoreImage src={footer.brand.logoUrl} alt="" sizes="44px" />
                  </span>
                ) : null}
                <p className="min-w-0 truncate text-base font-bold" style={{ color: appearance.headingColor }}>
                  {footer.brand.name}
                </p>
              </div>
              {footer.brand.tagline ? (
                <p className="mt-3 max-w-sm break-words text-sm leading-relaxed opacity-90">{footer.brand.tagline}</p>
              ) : null}
              {footer.social.length ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {footer.social.map((item) => {
                    const Icon = SOCIAL_ICONS[item.id];
                    return (
                      <li key={item.id}>
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={item.label}
                          className="flex size-11 items-center justify-center rounded-full border transition-opacity duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
                          style={{ borderColor: appearance.borderColor, color: appearance.headingColor }}
                        >
                          <Icon className="size-4" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : footer.social.length ? (
            <ul className="flex flex-wrap gap-2">
              {footer.social.map((item) => {
                const Icon = SOCIAL_ICONS[item.id];
                return (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={item.label}
                      className="flex size-11 items-center justify-center rounded-full border"
                      style={{ borderColor: appearance.borderColor, color: appearance.headingColor }}
                    >
                      <Icon className="size-4" />
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="min-w-0 md:hidden">
            <Accordion type="multiple" className="divide-y-0 border-0">
              {visible.map((section) => (
                <AccordionItem key={section.id} value={section.id} className="border-b py-0" >
                  <AccordionTrigger
                    value={section.id}
                    className="min-h-11 py-3 text-sm font-semibold"
                  >
                    <span style={{ color: appearance.headingColor }}>{section.title}</span>
                  </AccordionTrigger>
                  <AccordionContent value={section.id} className="text-[inherit]">
                    <div className="flex flex-col items-start pb-2">{section.content}</div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {visible.map((section) => (
            <div key={section.id} className="hidden min-w-0 md:block">
              <FooterColumn title={section.title} headingColor={appearance.headingColor}>
                {section.content}
              </FooterColumn>
            </div>
          ))}
        </div>

        {footer.trust.length ? (
          <ul className="mt-8 flex min-w-0 flex-wrap gap-2">
            {footer.trust.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <FooterLink
                    item={item}
                    className="min-h-9 rounded-full border px-3 text-xs font-semibold"
                  />
                ) : (
                  <span
                    className="inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold"
                    style={{ borderColor: appearance.borderColor }}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="border-t" style={{ borderColor: appearance.borderColor }}>
        <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-2 px-3 py-4 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="min-w-0 break-words">
            © {year} {footer.copyrightName}. All rights reserved.
          </p>
          {footer.poweredBy ? (
            <p className="min-w-0">
              Powered by{" "}
              <Link href="/" className="font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                Postbus
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
