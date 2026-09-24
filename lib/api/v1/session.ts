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
          .from("subscriptions")
          .select("status, plans(slug, name)")
          .eq("organization_id", organization.id)
          .in("status", ["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "PAYMENT_FAILED"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    const plan = subscription?.plans as { slug?: string; name?: string } | { slug?: string; name?: string }[] | null;
    const planRow = Array.isArray(plan) ? plan[0] : plan;
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
        planCode: planRow?.slug,
        planName: planRow?.name,
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
