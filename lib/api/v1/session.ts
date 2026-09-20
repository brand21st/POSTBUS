import { z } from "zod";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { createOrganization, listMemberships } from "@/modules/organizations/service";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function handleSessionRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  key: string
) {
  if (key === "GET me") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    const memberships = await listMemberships(supabase, user.id);
    let organization = null;
    let role = null;
    if (profile?.active_organization_id) {
      const current = memberships.find((item) => item.organization_id === profile.active_organization_id);
      const org = Array.isArray(current?.organizations) ? current?.organizations[0] : current?.organizations;
      organization = org ? { id: org.id, name: org.name, slug: org.slug } : null;
      role = current?.role ?? null;
    }
    const { data: subscription } = organization
      ? await supabase
          .from("organization_subscriptions")
          .select("status, billing_plans(code, name)")
          .eq("organization_id", organization.id)
          .maybeSingle()
      : { data: null };
    const plan = subscription?.billing_plans as { code?: string; name?: string } | null;
    return {
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        fullName: profile?.full_name,
        avatarUrl: profile?.avatar_url,
        whatsappNumber: profile?.whatsapp_number ?? null,
      },
      organization,
      role,
      organizations: memberships.map((item) => {
        const org = Array.isArray(item.organizations) ? item.organizations[0] : item.organizations;
        return { id: org?.id, name: org?.name, slug: org?.slug, role: item.role };
      }),
      subscription: {
        planCode: plan?.code,
        planName: plan?.name,
        status: subscription?.status ?? "CONFIGURATION_REQUIRED",
      },
    };
  }

  if (key === "POST organizations") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
    const body = await request.json().catch(() => ({}));
    const name = z.string().min(2).parse(body.name);
    return createOrganization(supabase, user.id, name);
  }

  return null;
}
