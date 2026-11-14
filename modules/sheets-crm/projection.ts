import type { SupabaseClient } from "@supabase/supabase-js";
import type { SheetsCrmLifecycle, SheetsCrmSignupSource, SheetsCrmSnapshot, SheetsCrmWorkspace } from "@/modules/sheets-crm/events";

type OrgRow = {
  id: string;
  name: string | null;
  created_at: string;
  account_status: string | null;
};

type StatusRow = { organization_id: string; status: string | null };
type SubscriptionRow = {
  organization_id: string;
  status: string | null;
  plans?: { name?: string | null } | { name?: string | null }[] | null;
};

function planName(row: SubscriptionRow) {
  const plans = row.plans;
  const plan = Array.isArray(plans) ? plans[0] : plans;
  return plan?.name?.trim() || "";
}

function missingRelation(message: string) {
  const text = message.toLowerCase();
  return text.includes("does not exist") || text.includes("schema cache");
}

function connected(rows: StatusRow[] | null | undefined, organizationId: string) {
  return (rows ?? []).some(
    (row) => row.organization_id === organizationId && String(row.status ?? "").toUpperCase() === "CONNECTED"
  );
}

export async function loadCrmSnapshot(
  supabase: SupabaseClient,
  customerId: string
): Promise<SheetsCrmSnapshot | null> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, whatsapp_number, created_at, last_active_at")
    .eq("id", customerId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) return null;

  const { data: members, error: memberError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", customerId)
    .eq("role", "OWNER");
  if (memberError) throw new Error(memberError.message);
  const orgIds = [...new Set((members ?? []).map((row) => row.organization_id).filter(Boolean))];

  const [orgs, india, shopify, woo, appInstalls, subscriptions, affiliate] = await Promise.all([
    orgIds.length
      ? supabase.from("organizations").select("id, name, created_at, account_status").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? supabase.from("india_post_connections").select("organization_id, status").in("organization_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? supabase.from("shopify_connections").select("organization_id, status").in("organization_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? supabase.from("woocommerce_connections").select("organization_id, status").in("organization_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? supabase.from("shopify_app_installations").select("organization_id, status").in("organization_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? supabase.from("subscriptions").select("organization_id, status, plans(name)").in("organization_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("affiliate_signup_claims").select("user_id").eq("user_id", customerId).maybeSingle(),
  ]);
  for (const result of [orgs, india, shopify, woo, subscriptions]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (appInstalls.error && !missingRelation(appInstalls.error.message)) throw new Error(appInstalls.error.message);
  if (affiliate.error && !missingRelation(affiliate.error.message)) throw new Error(affiliate.error.message);

  const subscriptionByOrg = new Map<string, SubscriptionRow>();
  for (const row of (subscriptions.data ?? []) as SubscriptionRow[]) {
    subscriptionByOrg.set(row.organization_id, row);
  }
  const shopifyRows = [...((shopify.data ?? []) as StatusRow[]), ...((appInstalls.data ?? []) as StatusRow[])];
  const workspaces: SheetsCrmWorkspace[] = ((orgs.data ?? []) as OrgRow[]).map((org) => {
    const subscription = subscriptionByOrg.get(org.id);
    return {
      id: org.id,
      name: org.name?.trim() || "Workspace",
      createdAt: org.created_at,
      accountStatus: org.account_status || "ACTIVE",
      indiaPostConnected: connected(india.data as StatusRow[], org.id),
      shopifyConnected: connected(shopifyRows, org.id),
      wooConnected: connected(woo.data as StatusRow[], org.id),
      planName: subscription ? planName(subscription) : "",
      subscriptionStatus: subscription?.status || "",
    };
  });

  const email = profile.email?.trim() || "";
  const phone = profile.whatsapp_number?.trim() || "";
  let signupSource: SheetsCrmSignupSource = "email";
  if (affiliate.data) signupSource = "affiliate";
  else if (workspaces.some((workspace) => workspace.shopifyConnected)) signupSource = "shopify";
  else if (phone && !email) signupSource = "whatsapp";

  return {
    customerId: profile.id,
    fullName: profile.full_name?.trim() || "",
    email,
    phone,
    signupAt: profile.created_at,
    signupSource,
    lastActiveAt: profile.last_active_at ?? null,
    workspaces,
  };
}

export type StoredProjection = {
  customerId: string;
  lifecycle: SheetsCrmLifecycle;
  onboardingCompletedAt: string | null;
  projectionHash: string | null;
  lastActivityEnqueuedAt: string | null;
};

export async function loadStoredProjection(
  supabase: SupabaseClient,
  customerId: string
): Promise<StoredProjection | null> {
  const { data, error } = await supabase
    .from("sheets_crm_projections")
    .select("customer_id, lifecycle, onboarding_completed_at, projection_hash, last_activity_enqueued_at")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    customerId: data.customer_id,
    lifecycle: data.lifecycle as SheetsCrmLifecycle,
    onboardingCompletedAt: data.onboarding_completed_at ?? null,
    projectionHash: data.projection_hash ?? null,
    lastActivityEnqueuedAt: data.last_activity_enqueued_at ?? null,
  };
}
