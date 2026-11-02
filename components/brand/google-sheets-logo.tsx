import { cn } from "@/lib/utils";

export function GoogleSheetsLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
        <rect x="3" y="2" width="18" height="20" rx="2" fill="#0F9D58" />
        <path fill="#fff" d="M7 6h10v2H7zm0 4h10v2H7zm0 4h6v2H7z" />
      </svg>
      <span className="text-base font-semibold text-ink">Google Sheets</span>
    </span>
  );
}
