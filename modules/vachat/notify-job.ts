export type VachatNotifyJobKind = "support" | "session_text" | "signup_welcome" | "notice";

export function vachatNotifyJobKind(progress: unknown): VachatNotifyJobKind {
  const kind =
    progress && typeof progress === "object" ? (progress as { kind?: string }).kind : undefined;
  const source =
    progress && typeof progress === "object" ? (progress as { source?: string }).source : undefined;
  if (kind === "signup_welcome") return "signup_welcome";
  if (kind === "support_template") return "support";
  if (kind === "session_text" && source === "support") return "support";
  if (kind === "session_text") return "session_text";
  return "notice";
}
