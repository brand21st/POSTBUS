import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export const VACHAT_SIGNUP_URL = "https://www.vachat.in/";

export function VachatSignupLink({ className }: { className?: string }) {
  return (
    <a
      href={VACHAT_SIGNUP_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex w-fit items-center gap-2 text-sm font-medium text-brand hover:underline",
        className
      )}
    >
      Sign up at vachat.in
      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}
