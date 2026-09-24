import { z } from "zod";
import type { NextRequest } from "next/server";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeBillingAudit, writeSubscriptionHistory } from "@/modules/billing/audit";
import { yearlyPricePaise } from "@/modules/billing/prices";
import { getLiveSubscription, mapPlan, type PlanRow } from "@/modules/billing/subscriptions";
import {
  loadRazorpaySettings,
  registerRazorpayWebhook,
  saveRazorpaySettings,
  testRazorpaySettings,
} from "@/modules/razorpay/admin-settings";
import { getRazorpayConfig, publicRazorpayStatus } from "@/modules/razorpay/config";

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
  if (key === "GET trial-settings" || (key === "GET settings" && slugs[0] === "trial-settings")) {
    const { data } = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
    return data ?? { trial_enabled: true, trial_days: 14 };
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
      .select()
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
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "CANCELLED"),
    supabase.from("subscriptions").select("id, amount_paise, billing_cycle, plan_id, plans(slug)").eq("status", "ACTIVE"),
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
    const status = url.searchParams.get("status") ?? "";
    let query = supabase
      .from("organizations")
      .select("id, name, slug, account_status, created_at, created_by")
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) query = query.eq("account_status", status);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data: orgs } = await query;
    const ids = (orgs ?? []).map((row) => row.id);
    const { data: subs } = ids.length
      ? await supabase
          .from("subscriptions")
          .select("organization_id, status, billing_cycle, amount_paise, plans(name, slug)")
          .in("organization_id", ids)
          .in("status", ["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "PAYMENT_FAILED"])
      : { data: [] as never[] };
    const byOrg = new Map((subs ?? []).map((row) => [row.organization_id, row]));
    return {
      accounts: (orgs ?? []).map((org) => ({
        ...org,
        subscription: byOrg.get(org.id) ?? null,
      })),
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
  if (method === "POST" && action === "suspend") {
    await supabase.from("organizations").update({ account_status: "SUSPENDED" }).eq("id", orgId);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "account.suspended",
      organizationId: orgId,
      ip: ip(request),
    });
    return { accountStatus: "SUSPENDED" };
  }
  if (method === "POST" && action === "disable") {
    await supabase.from("organizations").update({ account_status: "DISABLED" }).eq("id", orgId);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "account.disabled",
      organizationId: orgId,
      ip: ip(request),
    });
    return { accountStatus: "DISABLED" };
  }
  if (method === "POST" && action === "change-plan") {
    const parsed = z.object({ planId: z.string().uuid(), billingCycle: z.enum(["monthly", "yearly"]).optional() }).parse(body);
    const live = await getLiveSubscription(supabase, orgId);
    const { data: plan } = await supabase.from("plans").select("*").eq("id", parsed.planId).maybeSingle();
    if (!plan) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Plan not found.");
    const cycle = parsed.billingCycle ?? live?.billing_cycle ?? "monthly";
    const amount = cycle === "yearly" ? Number(plan.yearly_price_paise) : Number(plan.monthly_price_paise);
    if (live) {
      await supabase
        .from("subscriptions")
        .update({
          plan_id: plan.id,
          billing_cycle: cycle,
          amount_paise: amount,
          order_limit: plan.monthly_order_limit,
        })
        .eq("id", live.id);
      await writeSubscriptionHistory(supabase, {
        organizationId: orgId,
        subscriptionId: live.id,
        fromPlanId: live.plan_id,
        toPlanId: plan.id,
        reason: "admin_change_plan",
        actor: ctx.userId,
      });
    }
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "subscription.plan_changed",
      organizationId: orgId,
      ip: ip(request),
      metadata: parsed,
    });
    return { ok: true };
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
    .select("*, plans(name, slug), organizations(name, slug, account_status)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data } = await query;
  return { subscriptions: data ?? [] };
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
    return { plans: (data as PlanRow[] | null)?.map(mapPlan) ?? [] };
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
    const { data, error } = await supabase
      .from("plans")
      .update({
        name: body.name,
        description: body.description ?? null,
        monthly_price_paise: body.monthlyPricePaise,
        yearly_price_paise: body.yearlyPricePaise ?? yearlyPricePaise(body.monthlyPricePaise),
        monthly_order_limit: body.monthlyOrderLimit,
        features: body.features ?? [],
        display_order: body.displayOrder,
        razorpay_monthly_plan_id: body.razorpayMonthlyPlanId,
        razorpay_yearly_plan_id: body.razorpayYearlyPlanId,
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
