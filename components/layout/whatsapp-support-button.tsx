import { siteConfig } from "@/lib/site-config";

export function WhatsappSupportButton() {
  const href = `https://wa.me/${siteConfig.supportWhatsapp}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="WhatsApp Support"
      className="fixed bottom-5 left-5 z-[60] flex items-center gap-2.5 rounded-full bg-[#25D366] p-3 text-white shadow-[0_8px_28px_rgb(37_211_102/0.45)] transition hover:bg-[#1ebe5d] hover:shadow-[0_10px_32px_rgb(37_211_102/0.55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] sm:bottom-6 sm:left-auto sm:right-6 sm:py-3 sm:pl-3.5 sm:pr-4"
    >
      <WhatsappIcon />
      <span className="hidden pr-1 text-sm font-semibold tracking-tight sm:inline">WhatsApp Support</span>
    </a>
  );
}

function WhatsappIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-6 shrink-0 fill-current"
    >
      <path d="M12.04 2C6.58 2 2.15 6.43 2.15 11.89c0 1.76.46 3.48 1.34 5L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.89-4.43 9.89-9.89C21.94 6.43 17.5 2 12.04 2Zm5.75 14.07c-.24.67-1.4 1.24-1.94 1.32-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.26-4.79-4.19-4.94-4.38-.14-.2-1.18-1.57-1.18-3 0-1.42.74-2.12 1.01-2.41.26-.28.58-.35.77-.35h.56c.18 0 .42-.07.65.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.2-.14.32-.28.5-.14.17-.3.38-.42.51-.14.14-.29.3-.12.58.16.28.73 1.2 1.57 1.94 1.08.96 1.99 1.26 2.27 1.4.28.14.44.12.6-.07.17-.2.7-.81.88-1.09.19-.28.37-.23.63-.14.26.1 1.64.77 1.92.91.28.14.47.21.54.33.07.12.07.7-.17 1.37Z" />
    </svg>
  );
}
