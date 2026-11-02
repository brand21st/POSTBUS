import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { permissionsFor } from "@/lib/permissions/rbac";

let entitlement: Record<string, unknown> | null = null;

function fakeAdmin() {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "limit"]) chain[name] = () => chain;
  chain.maybeSingle = async () => ({ data: entitlement, error: null });
  return { from: () => chain } as unknown as SupabaseClient;
}

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
  createAdminClient: () => fakeAdmin(),
}));
vi.mock("@/modules/ai-accountant/overview", () => ({ loadOverview: vi.fn(async () => ({ pnl: { netProfitPaise: 1 } })) }));
const createExpense = vi.fn(async () => ({ id: "e1" }));
vi.mock("@/modules/ai-accountant/expenses", () => ({ createExpense, listExpenses: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn() }));
const askAiAccountant = vi.fn(async () => ({ answer: "ok" }));
vi.mock("@/modules/ai-accountant/assistant/run", () => ({
  askAiAccountant,
  getThread: vi.fn(),
  listThreads: vi.fn(),
  remainingAssistantQuota: vi.fn(),
}));

const { handleAiAccountantRoutes } = await import("@/lib/api/v1/ai-accountant");

const ctx: TenantContext = {
  userId: "user-1",
  email: null,
  fullName: null,
  organizationId: "org-1",
  organizationName: "Org",
  role: "OWNER",
  permissions: permissionsFor("OWNER"),
};

function call(method: string, path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1/${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
  const slugs = path.split("/");
  return handleAiAccountantRoutes(request, {} as SupabaseClient, ctx, `${method} ${path}`, method, slugs);
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("AI Accountant routes", () => {
  beforeEach(() => {
    entitlement = null;
    createExpense.mockClear();
  });

  it("ignores other roots", async () => {
    expect(await call("GET", "orders")).toBeNull();
  });

  it("hides the module when the add-on was never bought", async () => {
    await expect(call("GET", "ai-accountant")).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
  });

  it("serves reads and blocks writes once the add-on has expired", async () => {
    entitlement = { status: "EXPIRED", current_period_end: past };
    await expect(call("GET", "ai-accountant")).resolves.toMatchObject({ accessMode: "READ_ONLY" });
    await expect(call("POST", "ai-accountant/expenses", {})).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(createExpense).not.toHaveBeenCalled();
    // Asking questions does not change books, so read-only workspaces may still ask.
    await expect(call("POST", "ai-accountant/assistant", { question: "Profit?" })).resolves.toMatchObject({ answer: "ok" });
  });

  it("routes writes when active", async () => {
    entitlement = { status: "ACTIVE", current_period_end: future };
    await expect(call("POST", "ai-accountant/expenses", { amountPaise: 100 })).resolves.toEqual({ id: "e1" });
    expect(createExpense).toHaveBeenCalledWith(expect.anything(), "org-1", { amountPaise: 100 }, "user-1");
  });

  it("validates ids and 404s unknown sub-routes", async () => {
    entitlement = { status: "ACTIVE", current_period_end: future };
    await expect(call("POST", "ai-accountant/journal/not-a-uuid/reverse")).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });
    await expect(call("GET", "ai-accountant/nope")).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
  });
});
