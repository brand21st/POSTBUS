import { z } from "zod";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { assertAdminActionPin } from "@/lib/admin/action-pin";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeBillingAudit, writeSubscriptionHistory } from "@/modules/billing/audit";
import { yearlyPricePaise } from "@/modules/billing/prices";
import { adminAssignPlan, getLiveSubscription, mapPlan, type PlanRow } from "@/modules/billing/subscriptions";
import { LIVE_STATUSES } from "@/modules/billing/usage";
import {
  loadRazorpaySettings,
  registerRazorpayWebhook,
  saveRazorpaySettings,
  testRazorpaySettings,
} from "@/modules/razorpay/admin-settings";
import {
  listOpenRouterChatGptModelsForAdmin,
  loadOpenRouterSettings,
  saveOpenRouterSettings,
  testOpenRouterSettings,
} from "@/modules/openrouter/admin-settings";
import {
  assignSupportUnassigned,
  loadPlatformVachatLogs,
  loadPlatformVachatSettings,
  loadPlatformVachatStats,
  loadSupportUnassigned,
  registerPlatformVachatWebhook,
  savePlatformVachatSettings,
  sendPlatformVachatTest,
  testPlatformVachatSettings,
} from "@/modules/vachat/admin-settings";
import { getRazorpayConfig, publicRazorpayStatus } from "@/modules/razorpay/config";
import { handleAdminTutorials } from "@/lib/api/admin/tutorials";
import { latestLastActiveAt } from "@/lib/admin/user-presence";
import {
  ADMIN_ACCOUNT_STATUSES,
  listPageRange,
  parseAdminAccountListParams,
} from "@/lib/admin/account-list";

const planSchema = z.object({
  slug: z.string().min(2).optional(),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  monthlyPricePaise: z.number().int().nonnegative(),
  yearlyPricePaise: z.number().int().nonnegative().optional(),
  monthlyOrderLimit: z.number().int().positive(),
  features: z.array(z.string()).optional(),
  displayOrder: z.number().int().optional(),
  razorpayMonthlyPlanId: z.string().optional().nullable(),
  razorpayYearlyPlanId: z.string().optional().nullable(),
});

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

export async function handleAdminRoutes(
  request: NextRequest,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  const supabase = createAdminClient();
  const path = slugs.join("/");
  const key = `${method} ${path}`;

  if (key === "GET billing/overview" || key === "GET overview" || key === "GET dashboard") {
    return loadOverview(supabase);
  }
  if (key === "GET revenue") return loadRevenue(supabase);
  if (key === "GET usage") return loadUsage(supabase);
  if (key === "GET razorpay") return loadRazorpayStatus(supabase);
  if (key === "GET settings/razorpay") return loadRazorpaySettings();
  if (key === "PATCH settings/razorpay") return saveRazorpaySettings(request, supabase, ctx);
  if (key === "POST settings/razorpay/test") return testRazorpaySettings(request, supabase, ctx);
  if (key === "POST settings/razorpay/webhook") return registerRazorpayWebhook(request, supabase, ctx);
  if (key === "GET settings/openrouter") return loadOpenRouterSettings();
  if (key === "GET settings/openrouter/models") return listOpenRouterChatGptModelsForAdmin();
  if (key === "PATCH settings/openrouter") return saveOpenRouterSettings(request, supabase, ctx);
  if (key === "POST settings/openrouter/test") return testOpenRouterSettings(request, supabase, ctx);
  if (key === "GET settings/vachat") return loadPlatformVachatSettings();
  if (key === "PATCH settings/vachat") return savePlatformVachatSettings(request, supabase, ctx);
  if (key === "POST settings/vachat/test") return testPlatformVachatSettings(request, supabase, ctx);
  if (key === "POST settings/vachat/send-test") return sendPlatformVachatTest(request, supabase, ctx);
  if (key === "POST settings/vachat/webhook") return registerPlatformVachatWebhook(request, supabase, ctx);
  if (key === "GET settings/vachat/stats") return loadPlatformVachatStats(supabase);
  if (key === "GET settings/vachat/logs") return loadPlatformVachatLogs(request, supabase);
  if (key === "GET settings/vachat/unassigned") return loadSupportUnassigned(supabase);
  if (key === "POST settings/vachat/unassigned/assign") return assignSupportUnassigned(request, supabase, ctx);
  if (key === "GET trial-settings" || (key === "GET settings" && slugs[0] === "trial-settings")) {
    const { data } = await supabase
      .from("platform_settings")
      .select("trial_enabled, trial_days")
      .eq("id", 1)
      .maybeSingle();
    return data ?? { trial_enabled: true, trial_days: 7 };
  }
  if (key === "PATCH trial-settings") {
    const body = z
      .object({ trialEnabled: z.boolean().optional(), trialDays: z.number().int().min(0).max(90).optional() })
      .parse(await request.json());
    const { data, error } = await supabase
      .from("platform_settings")
      .update({
        trial_enabled: body.trialEnabled,
        trial_days: body.trialDays,
      })
      .eq("id", 1)
      .select("trial_enabled, trial_days")
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "trial.settings_updated",
      ip: ip(request),
      metadata: body,
    });
    return data;
  }

  if (slugs[0] === "accounts") return handleAccounts(request, supabase, ctx, slugs, method);
  if (slugs[0] === "subscriptions") return handleSubscriptions(supabase, request);
  if (slugs[0] === "payments") return handlePayments(supabase, request);
  if (slugs[0] === "plans") return handlePlans(request, supabase, ctx, slugs, method);
  if (slugs[0] === "ai-credits") {
    const { handleAdminAiCredits } = await import("@/modules/ai-credits/admin");
    return handleAdminAiCredits(request, supabase, ctx, slugs, method);
  }
  if (slugs[0] === "tutorials" || slugs[0] === "tutorial-categories") {
    return handleAdminTutorials(request, supabase, ctx, slugs, method);
  }
  if (slugs[0] === "audit-logs") {
    const { data } = await supabase
      .from("billing_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return { logs: data ?? [] };
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

async function loadOverview(supabase: ReturnType<typeof createAdminClient>) {
  const [
    accounts,
    activeAccounts,
    trial,
    activeTrials,
    expiredTrials,
    paidSubs,
    cancelled,
    activeSubs,
    monthly,
    yearly,
    captured,
    failed,
    expiring,
    usageAll,
    usageToday,
    usageMonth,
  ] = await Promise.all([
    supabase.from("organizations").select("id", { count: "exact", head: true }),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("account_status", "ACTIVE"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "TRIAL"),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "TRIAL")
      .gt("trial_end", new Date().toISOString()),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "EXPIRED"),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE")
      .or("razorpay_subscription_id.not.is.null,amount_paise.gt.0"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "CANCELLED"),
    supabase.from("subscriptions").select("id, amount_paise, billing_cycle, plan_id, plans!plan_id(slug)").eq("status", "ACTIVE"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("billing_cycle", "monthly").eq("status", "ACTIVE"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("billing_cycle", "yearly").eq("status", "ACTIVE"),
    supabase.from("payments").select("amount_paise, created_at, status").eq("status", "CAPTURED"),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["TRIAL", "ACTIVE"])
      .lte("current_period_end", new Date(Date.now() + 7 * 86400000).toISOString())
      .gte("current_period_end", new Date().toISOString()),
    supabase.from("usage_events").select("quantity"),
    supabase.from("usage_events").select("quantity").gte("occurred_at", startOfDay()),
    supabase.from("usage_events").select("quantity").gte("occurred_at", startOfMonth()),
  ]);

  const activeRows = activeSubs.data ?? [];
  const mrr = activeRows.reduce((sum, row) => {
    const amount = Number(row.amount_paise ?? 0);
    return sum + (row.billing_cycle === "yearly" ? Math.round(amount / 12) : amount);
  }, 0);
  const collected = (captured.data ?? []).reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0);
  const pending = await supabase.from("payments").select("amount_paise").eq("status", "PENDING");
  const pendingTotal = (pending.data ?? []).reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0);
  const planCounts: Record<string, number> = {};
  for (const row of activeRows) {
    const plan = row.plans as { slug?: string } | { slug?: string }[] | null;
    const slug = (Array.isArray(plan) ? plan[0]?.slug : plan?.slug) ?? "unknown";
    planCounts[slug] = (planCounts[slug] ?? 0) + 1;
  }

  const orders = (rows: { quantity?: number }[] | null) =>
    (rows ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 1), 0);

  const revenueSeries = lastNDays(30).map((day) => ({
    date: day,
    amount: (captured.data ?? [])
      .filter((row) => (row.created_at ?? "").startsWith(day))
      .reduce((sum, row) => sum + Number(row.amount_paise ?? 0) / 100, 0),
  }));

  return {
    totals: {
      accounts: accounts.count ?? 0,
      activeAccounts: activeAccounts.count ?? 0,
      trialAccounts: trial.count ?? 0,
      activeTrials: activeTrials.count ?? 0,
      expiredTrials: expiredTrials.count ?? 0,
      paidAccounts: paidSubs.count ?? 0,
      cancelledAccounts: cancelled.count ?? 0,
      activeSubscriptions: activeRows.length,
      monthlySubscriptions: monthly.count ?? 0,
      yearlySubscriptions: yearly.count ?? 0,
      collectedRevenuePaise: collected,
      subscriptionValuePaise: activeRows.reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0),
      pendingPaymentsPaise: pendingTotal,
      mrrPaise: mrr,
      arrPaise: mrr * 12,
      failedPayments: failed.count ?? 0,
      expiringSubscriptions: expiring.count ?? 0,
      ordersProcessed: orders(usageAll.data),
      ordersToday: orders(usageToday.data),
      ordersMonth: orders(usageMonth.data),
    },
    planDistribution: Object.entries(planCounts).map(([name, value]) => ({ name, value })),
    revenueSeries,
  };
}

function lastNDays(n: number) {
  return Array.from({ length: n }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (n - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

async function loadRevenue(supabase: ReturnType<typeof createAdminClient>) {
  const { data: payments } = await supabase
    .from("payments")
    .select("amount_paise, status, billing_cycle, plan_id, created_at, plans(name, slug)")
    .order("created_at", { ascending: false })
    .limit(500);
  const captured = (payments ?? []).filter((row) => row.status === "CAPTURED");
  const byPlan: Record<string, number> = {};
  const byCycle: Record<string, number> = {};
  for (const row of captured) {
    const plan = row.plans as { name?: string } | { name?: string }[] | null;
    const name = (Array.isArray(plan) ? plan[0]?.name : plan?.name) ?? "Unknown";
    byPlan[name] = (byPlan[name] ?? 0) + Number(row.amount_paise ?? 0);
    const cycle = row.billing_cycle ?? "unknown";
    byCycle[cycle] = (byCycle[cycle] ?? 0) + Number(row.amount_paise ?? 0);
  }
  const { count: accounts } = await supabase.from("organizations").select("id", { count: "exact", head: true });
  const collected = captured.reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0);
  return {
    collectedRevenuePaise: collected,
    refundsPaise: (payments ?? [])
      .filter((row) => row.status === "REFUNDED")
      .reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0),
    failedCount: (payments ?? []).filter((row) => row.status === "FAILED").length,
    revenueByPlan: Object.entries(byPlan).map(([name, amountPaise]) => ({ name, amountPaise })),
    revenueByCycle: Object.entries(byCycle).map(([name, amountPaise]) => ({ name, amountPaise })),
    arpaPaise: accounts ? Math.round(collected / accounts) : 0,
  };
}

async function loadUsage(supabase: ReturnType<typeof createAdminClient>) {
  const { data } = await supabase
    .from("billing_usage")
    .select("organization_id, orders_used, order_limit, period_start, period_end, organizations(name)")
    .order("orders_used", { ascending: false })
    .limit(100);
  return { usage: data ?? [] };
}

async function loadRazorpayStatus(supabase: ReturnType<typeof createAdminClient>) {
  const [{ count: total }, { count: captured }, { count: failed }, { count: refunds }, { data: recent }] =
    await Promise.all([
      supabase.from("payments").select("id", { count: "exact", head: true }),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "CAPTURED"),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "FAILED"),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "REFUNDED"),
      supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
  const { data: capturedRows } = await supabase.from("payments").select("amount_paise").eq("status", "CAPTURED");
  const status = publicRazorpayStatus(await getRazorpayConfig());
  return {
    connected: status.connected,
    keyIdMasked: status.keyIdMasked,
    webhookConfigured: status.webhookConfigured,
    mode: status.mode,
    totals: {
      payments: total ?? 0,
      captured: captured ?? 0,
      failed: failed ?? 0,
      refunds: refunds ?? 0,
      revenuePaise: (capturedRows ?? []).reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0),
    },
    recent: recent ?? [],
  };
}

function signupSearchFilter(q: string) {
  const safe = q.replace(/[%*,()"]/g, " ").trim();
  if (!safe) return null;
  const pattern = `%${safe}%`;
  return `full_name.ilike."${pattern}",email.ilike."${pattern}",whatsapp_number.ilike."${pattern}",pincode.ilike."${pattern}",city.ilike."${pattern}"`;
}

type AdminClient = ReturnType<typeof createAdminClient>;

function applyOrgSearch<T extends { ilike: (column: string, pattern: string) => T }>(query: T, q: string) {
  return q ? query.ilike("name", `%${q}%`) : query;
}

async function countAccountSignups(supabase: AdminClient, q: string) {
  let query = supabase.from("profiles").select("id", { count: "exact", head: true });
  const filter = signupSearchFilter(q);
  if (filter) query = query.or(filter);
  const { count } = await query;
  return count ?? 0;
}

async function countAbandonedSignups(supabase: AdminClient, q: string) {
  let query = supabase.from("admin_abandoned_signups").select("id", { count: "exact", head: true });
  const filter = signupSearchFilter(q);
  if (filter) query = query.or(filter);
  const { count } = await query;
  return count ?? 0;
}

async function countWorkspaces(supabase: AdminClient, q: string) {
  const counts = {
    all: 0,
    ACTIVE: 0,
    BLOCKED: 0,
    SUSPENDED: 0,
    HOLD: 0,
    DISABLED: 0,
  };
  const queries = [
    applyOrgSearch(supabase.from("organizations").select("id", { count: "exact", head: true }), q),
    ...ADMIN_ACCOUNT_STATUSES.map((status) =>
      applyOrgSearch(
        supabase.from("organizations").select("id", { count: "exact", head: true }).eq("account_status", status),
        q
      )
    ),
  ];
  const results = await Promise.all(queries);
  counts.all = results[0]?.count ?? 0;
  ADMIN_ACCOUNT_STATUSES.forEach((accountStatus, index) => {
    counts[accountStatus] = results[index + 1]?.count ?? 0;
  });
  return counts;
}

async function listAccountSignups(
  supabase: AdminClient,
  q: string,
  page: number,
  pageSize: number,
  knownTotal?: number
) {
  const total = knownTotal ?? (await countAccountSignups(supabase, q));
  const range = listPageRange(page, pageSize, total);
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, whatsapp_number, pincode, city, created_at, last_active_at, active_organization_id")
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  const filter = signupSearchFilter(q);
  if (filter) query = query.or(filter);
  const { data: profiles } = await query;
  const userIds = (profiles ?? []).map((row) => row.id);
  const { data: members } =
    userIds.length > 0
      ? await supabase
          .from("organization_members")
          .select("user_id, role, organizations(id, name, slug)")
          .in("user_id", userIds)
      : { data: [] as never[] };

  const orgByUser = new Map<string, { id: string; name: string; slug: string }>();
  const ownerSet = new Set<string>();
  for (const row of members ?? []) {
    const orgRaw = row.organizations as
      | { id: string; name: string; slug: string }
      | { id: string; name: string; slug: string }[]
      | null;
    const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;
    if (!org) continue;
    if (row.role === "OWNER") {
      orgByUser.set(row.user_id, { id: org.id, name: org.name, slug: org.slug });
      ownerSet.add(row.user_id);
      continue;
    }
    if (!ownerSet.has(row.user_id) && !orgByUser.has(row.user_id)) {
      orgByUser.set(row.user_id, { id: org.id, name: org.name, slug: org.slug });
    }
  }

  return {
    total: range.total,
    page: range.page,
    items: (profiles ?? []).map((profile) => ({
      id: profile.id,
      fullName: profile.full_name ?? null,
      email: profile.email ?? null,
      whatsappNumber: profile.whatsapp_number ?? null,
      pincode: profile.pincode ?? null,
      city: profile.city ?? null,
      createdAt: profile.created_at,
      lastActiveAt: profile.last_active_at ?? null,
      organization: orgByUser.get(profile.id) ?? null,
    })),
  };
}

async function listAbandonedSignups(
  supabase: AdminClient,
  q: string,
  page: number,
  pageSize: number,
  knownTotal?: number
) {
  const total = knownTotal ?? (await countAbandonedSignups(supabase, q));
  const range = listPageRange(page, pageSize, total);
  let query = supabase
    .from("admin_abandoned_signups")
    .select("id, email, full_name, whatsapp_number, pincode, city, created_at")
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  const filter = signupSearchFilter(q);
  if (filter) query = query.or(filter);
  const { data: rows } = await query;
  return {
    total: range.total,
    page: range.page,
    items: (rows ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name ?? null,
      email: row.email ?? null,
      whatsappNumber: row.whatsapp_number ?? null,
      pincode: row.pincode ?? null,
      city: row.city ?? null,
      createdAt: row.created_at,
      lastActiveAt: null,
      organization: null,
      needsEmailConfirmation: true as const,
    })),
  };
}

async function handleAccounts(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  if (method === "GET" && slugs.length === 1) {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const { tab, page, pageSize, status } = parseAdminAccountListParams(url.searchParams);
    const [workspaceCounts, signupTotal, abandonedTotal] = await Promise.all([
      countWorkspaces(supabase, q),
      countAccountSignups(supabase, q),
      countAbandonedSignups(supabase, q),
    ]);
    const filteredWorkspaceTotal =
      status === "ACTIVE" ||
      status === "BLOCKED" ||
      status === "SUSPENDED" ||
      status === "HOLD" ||
      status === "DISABLED"
        ? workspaceCounts[status]
        : workspaceCounts.all;
    const listTotal =
      tab === "signups" ? signupTotal : tab === "abandoned" ? abandonedTotal : filteredWorkspaceTotal;
    const range = listPageRange(page, pageSize, listTotal);

    let accounts: Array<Record<string, unknown>> = [];
    let signups: Awaited<ReturnType<typeof listAccountSignups>>["items"] = [];
    if (tab === "signups") {
      signups = (await listAccountSignups(supabase, q, range.page, pageSize, signupTotal)).items;
    } else if (tab === "abandoned") {
      signups = (await listAbandonedSignups(supabase, q, range.page, pageSize, abandonedTotal)).items;
    } else {
      let query = applyOrgSearch(
        supabase
          .from("organizations")
          .select("id, name, slug, account_status, created_at, created_by")
          .order("created_at", { ascending: false })
          .range(range.from, range.to),
        q
      );
      if (status) query = query.eq("account_status", status);
      const { data: orgs } = await query;
      const ids = (orgs ?? []).map((row) => row.id);
      const { data: subs } = ids.length
        ? await supabase
            .from("subscriptions")
            .select("organization_id, status, billing_cycle, amount_paise, plan_id, plans!plan_id(name, slug)")
            .in("organization_id", ids)
            .in("status", ["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "PAYMENT_FAILED"])
        : { data: [] as never[] };
      const { data: members } = ids.length
        ? await supabase.from("organization_members").select("organization_id, user_id").in("organization_id", ids)
        : { data: [] as never[] };
      const memberUserIds = [...new Set((members ?? []).map((row) => row.user_id))];
      const { data: memberProfiles } = memberUserIds.length
        ? await supabase.from("profiles").select("id, last_active_at").in("id", memberUserIds)
        : { data: [] as never[] };
      const lastByUser = new Map((memberProfiles ?? []).map((row) => [row.id, row.last_active_at ?? null]));
      const lastByOrg = new Map<string, string | null>();
      for (const row of members ?? []) {
        lastByOrg.set(
          row.organization_id,
          latestLastActiveAt([lastByOrg.get(row.organization_id), lastByUser.get(row.user_id)])
        );
      }
      const byOrg = new Map((subs ?? []).map((row) => [row.organization_id, row]));
      accounts = (orgs ?? []).map((org) => ({
        ...org,
        lastActiveAt: lastByOrg.get(org.id) ?? null,
        subscription: byOrg.get(org.id) ?? null,
      }));
    }

    return {
      accounts,
      signups,
      totals: {
        workspaces: workspaceCounts.all,
        signups: signupTotal,
        abandoned: abandonedTotal,
        statuses: workspaceCounts,
      },
      page: range.page,
      pageSize,
      tab,
    };
  }

  const orgId = slugs[1];
  if (!orgId) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Account id required.");

  if (method === "GET" && slugs.length === 2) {
    const { data: org } = await supabase.from("organizations").select("*").eq("id", orgId).maybeSingle();
    if (!org) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Account not found.");
    const subscription = await getLiveSubscription(supabase, orgId);
    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    const { data: usage } = await supabase
      .from("billing_usage")
      .select("*")
      .eq("organization_id", orgId)
      .order("period_start", { ascending: false })
      .limit(12);
    const { data: history } = await supabase
      .from("subscription_history")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id, role, profiles(email, full_name)")
      .eq("organization_id", orgId);
    return { account: org, subscription, payments: payments ?? [], usage: usage ?? [], history: history ?? [], members: members ?? [] };
  }

  const action = slugs[2];
  const body = await request.json().catch(() => ({}));

  if (method === "POST" && action === "activate") {
    await supabase.from("organizations").update({ account_status: "ACTIVE" }).eq("id", orgId);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "account.activated",
      organizationId: orgId,
      ip: ip(request),
    });
    return { accountStatus: "ACTIVE" };
  }
  if (method === "POST" && (action === "suspend" || action === "block" || action === "hold" || action === "disable")) {
    assertAdminActionPin((body as { pin?: unknown }).pin);
    const status =
      action === "block" ? "BLOCKED" : action === "hold" ? "HOLD" : action === "disable" ? "DISABLED" : "SUSPENDED";
    const { data: existing } = await supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
    if (!existing) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Account not found.");
    await supabase.from("organizations").update({ account_status: status }).eq("id", orgId);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: `account.${action}`,
      organizationId: orgId,
      ip: ip(request),
      metadata: { accountStatus: status },
    });
    return { accountStatus: status };
  }
  if (method === "POST" && action === "delete") {
    assertAdminActionPin((body as { pin?: unknown }).pin);
    const { data: existing } = await supabase
      .from("organizations")
      .select("id, name, slug")
      .eq("id", orgId)
      .maybeSingle();
    if (!existing) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Account not found.");
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "account.deleted",
      organizationId: orgId,
      targetType: "organization",
      targetId: orgId,
      ip: ip(request),
      metadata: { name: existing.name, slug: existing.slug },
    });
    const { error } = await supabase.from("organizations").delete().eq("id", orgId);
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    return { deleted: true, id: orgId };
  }
  if (method === "POST" && action === "change-plan") {
    const parsed = z
      .object({
        pin: z.string().min(1),
        planId: z.string().uuid(),
        billingCycle: z.enum(["monthly", "yearly"]).optional(),
      })
      .parse(body);
    assertAdminActionPin(parsed.pin);
    return adminAssignPlan(supabase, {
      organizationId: orgId,
      userId: ctx.userId,
      planId: parsed.planId,
      billingCycle: parsed.billingCycle,
      ip: ip(request),
    });
  }
  if (method === "POST" && action === "extend") {
    const parsed = z.object({ days: z.number().int().min(1).max(365) }).parse(body);
    const live = await getLiveSubscription(supabase, orgId);
    if (!live) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No live subscription.");
    const end = new Date(live.current_period_end ?? Date.now());
    end.setDate(end.getDate() + parsed.days);
    await supabase
      .from("subscriptions")
      .update({
        current_period_end: end.toISOString(),
        renews_at: end.toISOString(),
        expires_at: end.toISOString(),
        trial_manual_override: true,
      })
      .eq("id", live.id);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "subscription.extended",
      organizationId: orgId,
      ip: ip(request),
      metadata: parsed,
    });
    return { currentPeriodEnd: end.toISOString() };
  }
  if (method === "POST" && action === "trial") {
    const parsed = z.object({ days: z.number().int().min(0).max(90) }).parse(body);
    const live = await getLiveSubscription(supabase, orgId);
    if (!live) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "No live subscription.");
    const end = new Date();
    end.setDate(end.getDate() + parsed.days);
    await supabase
      .from("subscriptions")
      .update({
        status: parsed.days > 0 ? "TRIAL" : live.status,
        trial_end: end.toISOString(),
        current_period_end: end.toISOString(),
        trial_manual_override: true,
      })
      .eq("id", live.id);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "subscription.trial_adjusted",
      organizationId: orgId,
      ip: ip(request),
      metadata: parsed,
    });
    return { trialEnd: end.toISOString() };
  }
  if (method === "POST" && action === "reset-usage") {
    const live = await getLiveSubscription(supabase, orgId);
    if (live?.current_period_start) {
      await supabase
        .from("billing_usage")
        .update({ orders_used: 0, alert_80_sent_at: null, alert_90_sent_at: null, alert_100_sent_at: null })
        .eq("organization_id", orgId)
        .eq("period_start", live.current_period_start.slice(0, 10));
    }
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "usage.reset",
      organizationId: orgId,
      ip: ip(request),
    });
    return { reset: true };
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

async function handleSubscriptions(supabase: ReturnType<typeof createAdminClient>, request: NextRequest) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  let query = supabase
    .from("subscriptions")
    .select("*, plans!plan_id(name, slug), organizations(id, name, slug, account_status)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
  const orgIds = [...new Set((data ?? []).map((row) => row.organization_id).filter(Boolean))];
  const { data: owners } =
    orgIds.length > 0
      ? await supabase
          .from("organization_members")
          .select("organization_id, user_id, role")
          .in("organization_id", orgIds)
          .eq("role", "OWNER")
      : { data: [] as never[] };
  const userIds = [...new Set((owners ?? []).map((row) => row.user_id).filter(Boolean))];
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from("profiles").select("id, email, full_name").in("id", userIds)
      : { data: [] as never[] };
  const profileById = new Map((profiles ?? []).map((row) => [row.id, row]));
  const emailByOrg = new Map<string, { email: string | null; fullName: string | null }>();
  for (const row of owners ?? []) {
    if (emailByOrg.has(row.organization_id)) continue;
    const person = profileById.get(row.user_id);
    emailByOrg.set(row.organization_id, {
      email: person?.email ?? null,
      fullName: person?.full_name ?? null,
    });
  }
  return {
    subscriptions: (data ?? []).map((row) => ({
      ...row,
      owner: emailByOrg.get(row.organization_id) ?? null,
    })),
  };
}

async function handlePayments(supabase: ReturnType<typeof createAdminClient>, request: NextRequest) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const cycle = url.searchParams.get("cycle") ?? "";
  let query = supabase
    .from("payments")
    .select("*, plans(name, slug), organizations(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  if (cycle) query = query.eq("billing_cycle", cycle);
  const { data } = await query;
  return { payments: data ?? [] };
}

async function handlePlans(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  if (method === "GET" && slugs.length === 1) {
    const { data } = await supabase.from("plans").select("*").order("display_order", { ascending: true });
    const plans = (data as PlanRow[] | null)?.map(mapPlan) ?? [];
    const { data: subs } = await supabase.from("subscriptions").select("plan_id").in("status", [...LIVE_STATUSES]);
    const counts = new Map<string, number>();
    for (const row of subs ?? []) {
      if (!row.plan_id) continue;
      counts.set(row.plan_id, (counts.get(row.plan_id) ?? 0) + 1);
    }
    return {
      plans: plans.map((plan) => ({ ...plan, subscriberCount: counts.get(plan.id) ?? 0 })),
    };
  }
  if (method === "POST" && slugs.length === 1) {
    const body = planSchema.parse(await request.json());
    const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const { data, error } = await supabase
      .from("plans")
      .insert({
        slug,
        name: body.name,
        description: body.description ?? null,
        monthly_price_paise: body.monthlyPricePaise,
        yearly_price_paise: body.yearlyPricePaise ?? yearlyPricePaise(body.monthlyPricePaise),
        monthly_order_limit: body.monthlyOrderLimit,
        features: body.features ?? [],
        display_order: body.displayOrder ?? 99,
        razorpay_monthly_plan_id: body.razorpayMonthlyPlanId ?? null,
        razorpay_yearly_plan_id: body.razorpayYearlyPlanId ?? null,
      })
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "plan.created",
      targetType: "plan",
      targetId: data.id,
      ip: ip(request),
    });
    return mapPlan(data as PlanRow);
  }
  const planId = slugs[1];
  if (method === "PUT" && planId) {
    const body = planSchema.parse(await request.json());
    const { data: current } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
    if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Plan not found.");
    const yearly = body.yearlyPricePaise ?? yearlyPricePaise(body.monthlyPricePaise);
    const monthlyChanged = Number(current.monthly_price_paise) !== body.monthlyPricePaise;
    const yearlyChanged = Number(current.yearly_price_paise) !== yearly;
    const { data, error } = await supabase
      .from("plans")
      .update({
        name: body.name,
        description: body.description ?? null,
        monthly_price_paise: body.monthlyPricePaise,
        yearly_price_paise: yearly,
        monthly_order_limit: body.monthlyOrderLimit,
        features: body.features ?? [],
        display_order: body.displayOrder ?? current.display_order,
        razorpay_monthly_plan_id: monthlyChanged
          ? null
          : (body.razorpayMonthlyPlanId !== undefined ? body.razorpayMonthlyPlanId : current.razorpay_monthly_plan_id),
        razorpay_yearly_plan_id: yearlyChanged
          ? null
          : (body.razorpayYearlyPlanId !== undefined ? body.razorpayYearlyPlanId : current.razorpay_yearly_plan_id),
      })
      .eq("id", planId)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "plan.updated",
      targetType: "plan",
      targetId: planId,
      ip: ip(request),
    });
    return mapPlan(data as PlanRow);
  }
  if (method === "PATCH" && slugs[2] === "status" && planId) {
    const body = z.object({ isActive: z.boolean() }).parse(await request.json());
    const { data, error } = await supabase
      .from("plans")
      .update({ is_active: body.isActive })
      .eq("id", planId)
      .select()
      .single();
    if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, error.message);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: body.isActive ? "plan.activated" : "plan.archived",
      targetType: "plan",
      targetId: planId,
      ip: ip(request),
    });
    return mapPlan(data as PlanRow);
  }
  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
