import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { AccountantShell } from "@/components/ai-accountant/shell";
import { AI_ACCOUNTANT_SLUG } from "@/modules/addons/constants";
import { getAddonAccessMode } from "@/modules/addons/entitlements";
import { getRequestAuthUser } from "@/lib/supabase/request-auth";

export default async function AiAccountantLayout({ children }: { children: ReactNode }) {
  const auth = await getRequestAuthUser();
  if (!auth.user) redirect("/login?next=/dashboard/ai-accountant");
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("active_organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  const organizationId = profile?.active_organization_id as string | null;
  if (!organizationId) notFound();
  const mode = await getAddonAccessMode(auth.supabase, organizationId, AI_ACCOUNTANT_SLUG);
  if (mode === "NONE") notFound();
  return <AccountantShell accessMode={mode}>{children}</AccountantShell>;
}
