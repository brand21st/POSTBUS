/** Production GoTrue project. Staging Auth must never use this reference. */
export const PRODUCTION_SUPABASE_REF = "hgacoeoovjxkzfbesmvl";

export function isStagingAuthMode(input: { mode?: string; appUrl?: string }) {
  const mode = (input.mode ?? "").trim().toLowerCase();
  if (mode === "staging" || mode === "auth-staging") return true;
  const appUrl = (input.appUrl ?? "").toLowerCase();
  return appUrl.includes("auth-staging.postbus.in");
}

export function assertStagingAuthIsolation(input: {
  mode?: string;
  supabaseUrl?: string;
  appUrl?: string;
}) {
  if (!isStagingAuthMode(input)) return;

  const supabaseUrl = (input.supabaseUrl ?? "").trim().toLowerCase();
  if (!supabaseUrl) {
    throw new Error("Staging authentication requires NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (supabaseUrl.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error(
      "STOP: staging Auth is pointing at the production Supabase project. Refusing to start."
    );
  }
  if (supabaseUrl.includes("postbus.in") && !supabaseUrl.includes("auth-staging")) {
    throw new Error("STOP: staging Auth URL looks like a production PostBus host.");
  }
}
