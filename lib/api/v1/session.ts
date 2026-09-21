import { z } from "zod";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  createOrganization,
  ensureActiveWorkspace,
  listMemberships,
} from "@/modules/organizations/service";
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
    const ensured = await ensureActiveWorkspace(supabase, user.id, {
      fullName: profile?.full_name ?? user.user_metadata?.full_name,
      email: profile?.email ?? user.email,
      activeOrganizationId: profile?.active_organization_id,
    });
    const organization = ensured.current
      ? { id: ensured.current.id, name: ensured.current.name, slug: ensured.current.slug }
      : null;
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
      role: ensured.role,
      organizations: organization
        ? [{ id: organization.id, name: organization.name, slug: organization.slug, role: ensured.role }]
        : [],
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
    const existing = await listMemberships(supabase, user.id);
    if (existing[0]) {
      const org = Array.isArray(existing[0].organizations)
        ? existing[0].organizations[0]
        : existing[0].organizations;
      return org;
    }
    const body = await request.json().catch(() => ({}));
    const name = z.string().min(2).parse(body.name);
    return createOrganization(supabase, user.id, name);
  }

  return null;
}
