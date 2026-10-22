import { z } from "zod";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import {
  createOrganization,
  ensureActiveWorkspace,
  listMemberships,
} from "@/modules/organizations/service";
import { getOrganizationEntitlements } from "@/modules/billing/entitlements";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTransientAuthClass } from "@/lib/auth/session/classify";
import { getRequestAuthUser } from "@/lib/supabase/request-auth";
import { isMerchantApiOpenForOrg } from "@/modules/merchant-api/flags";
import { dismissIndiaPostOnboardingForUser } from "@/lib/dashboard/india-post-onboarding";
import { shouldWritePresence } from "@/lib/admin/user-presence";

export async function handleSessionRoutes(
  request: NextRequest,
  supabase: SupabaseClient,
  key: string
) {
  if (key === "GET me") {
    const auth = await getRequestAuthUser();
    const user = auth.user;
    if (auth.classification && isTransientAuthClass(auth.classification)) {
      throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Authentication is temporarily unavailable. Try again shortly.");
    }
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
    const entitlements = organization
      ? await getOrganizationEntitlements(supabase, organization.id)
      : null;
    return {
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        fullName: profile?.full_name,
        avatarUrl: profile?.avatar_url,
        whatsappNumber: profile?.whatsapp_number ?? null,
        indiaPostOnboardingDismissedAt: profile?.india_post_onboarding_dismissed_at ?? null,
      },
      organization,
      role: ensured.role,
      organizations: organization
        ? [{ id: organization.id, name: organization.name, slug: organization.slug, role: ensured.role }]
        : [],
      subscription: {
        planCode: entitlements?.planSlug,
        planName: entitlements?.planName,
        status: entitlements?.status ?? "CONFIGURATION_REQUIRED",
        features: entitlements?.features ?? [],
      },
      merchantApi: {
        enabled: isMerchantApiOpenForOrg(organization?.id),
      },
    };
  }

  if (key === "POST me/presence") {
    const auth = await getRequestAuthUser();
    const user = auth.user;
    if (auth.classification && isTransientAuthClass(auth.classification)) {
      throw new AppError(
        ERROR_CODES.AUTH_UNAVAILABLE,
        "Authentication is temporarily unavailable. Try again shortly."
      );
    }
    if (!user) throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("last_active_at")
      .eq("id", user.id)
      .maybeSingle();
    if (readError) {
      throw new AppError(ERROR_CODES.PROFILE_UNAVAILABLE, "Could not record activity.");
    }
    if (!shouldWritePresence(profile?.last_active_at ?? null)) {
      return { ok: true as const, skipped: true as const };
    }
    const lastActiveAt = new Date().toISOString();
    const { error } = await supabase.from("profiles").update({ last_active_at: lastActiveAt }).eq("id", user.id);
    if (error) {
      throw new AppError(ERROR_CODES.PROFILE_UNAVAILABLE, "Could not record activity.");
    }
    return { ok: true as const, lastActiveAt };
  }

  if (key === "PATCH me") {
    const auth = await getRequestAuthUser();
    const user = auth.user;
    if (auth.classification && isTransientAuthClass(auth.classification)) {
      throw new AppError(
        ERROR_CODES.AUTH_UNAVAILABLE,
        "Authentication is temporarily unavailable. Try again shortly."
      );
    }
    if (!user) throw new AppError(ERROR_CODES.AUTH_REQUIRED, "Please sign in to continue.");
    const body = await request.json().catch(() => ({}));
    z.object({ indiaPostOnboardingDismissedAt: z.literal(true) }).parse(body);
    return dismissIndiaPostOnboardingForUser(supabase, user.id);
  }

  if (key === "POST organizations") {
    const { user, classification } = await getRequestAuthUser();
    if (classification && isTransientAuthClass(classification)) {
      throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Authentication is temporarily unavailable. Try again shortly.");
    }
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
