import type { NextRequest } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { AdminContext } from "@/lib/api/admin-context";
import { writeBillingAudit } from "@/modules/billing/audit";
import {
  adminTutorialQuerySchema,
  patchCategorySchema,
  patchTutorialSchema,
  tutorialStatusBodySchema,
  upsertCategorySchema,
  upsertTutorialSchema,
} from "@/modules/tutorials/schema";
import {
  createCategory,
  createTutorial,
  deleteCategory,
  deleteTutorial,
  getAdminTutorial,
  listAdminCategories,
  listAdminTutorials,
  updateCategory,
  updateTutorial,
} from "@/modules/tutorials/service";

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function handleAdminTutorials(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  if (slugs[0] === "tutorial-categories") {
    return handleCategories(request, supabase, ctx, slugs, method);
  }
  if (slugs[0] !== "tutorials") {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
  }

  if (method === "GET" && slugs.length === 1) {
    const parsed = adminTutorialQuerySchema.parse({
      page: request.nextUrl.searchParams.get("page") ?? undefined,
      pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
      q: request.nextUrl.searchParams.get("q") || undefined,
      categoryId: request.nextUrl.searchParams.get("categoryId") || undefined,
      status: request.nextUrl.searchParams.get("status") || undefined,
    });
    return listAdminTutorials(supabase, parsed);
  }

  if (method === "POST" && slugs.length === 1) {
    const body = upsertTutorialSchema.parse(await request.json());
    const tutorial = await createTutorial(supabase, body);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "tutorial.created",
      targetType: "tutorial",
      targetId: tutorial.id,
      ip: ip(request),
      metadata: { title: tutorial.title, status: tutorial.status },
    });
    return tutorial;
  }

  const tutorialId = slugs[1];
  if (!tutorialId) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");

  if (method === "GET" && slugs.length === 2) {
    return getAdminTutorial(supabase, tutorialId);
  }

  if (method === "PATCH" && slugs[2] === "status") {
    const body = tutorialStatusBodySchema.parse(await request.json());
    const tutorial = await updateTutorial(supabase, tutorialId, { status: body.status });
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: body.status === "published" ? "tutorial.published" : "tutorial.unpublished",
      targetType: "tutorial",
      targetId: tutorialId,
      ip: ip(request),
      metadata: { status: body.status },
    });
    return tutorial;
  }

  if (method === "PATCH" && slugs.length === 2) {
    const body = patchTutorialSchema.parse(await request.json());
    const before = await getAdminTutorial(supabase, tutorialId);
    const tutorial = await updateTutorial(supabase, tutorialId, body);
    const publishedChanged = body.status && body.status !== before.status;
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: publishedChanged
        ? body.status === "published"
          ? "tutorial.published"
          : "tutorial.unpublished"
        : "tutorial.updated",
      targetType: "tutorial",
      targetId: tutorialId,
      ip: ip(request),
      metadata: { title: tutorial.title, status: tutorial.status },
    });
    return tutorial;
  }

  if (method === "DELETE" && slugs.length === 2) {
    const current = await getAdminTutorial(supabase, tutorialId);
    await deleteTutorial(supabase, tutorialId);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "tutorial.deleted",
      targetType: "tutorial",
      targetId: tutorialId,
      ip: ip(request),
      metadata: { title: current.title },
    });
    return { ok: true };
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}

async function handleCategories(
  request: NextRequest,
  supabase: ReturnType<typeof createAdminClient>,
  ctx: AdminContext,
  slugs: string[],
  method: string
) {
  if (method === "GET" && slugs.length === 1) {
    return listAdminCategories(supabase);
  }

  if (method === "POST" && slugs.length === 1) {
    const body = upsertCategorySchema.parse(await request.json());
    const category = await createCategory(supabase, body);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "tutorial_category.created",
      targetType: "tutorial_category",
      targetId: category.id,
      ip: ip(request),
      metadata: { name: category.name },
    });
    return category;
  }

  const categoryId = slugs[1];
  if (!categoryId) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");

  if (method === "PATCH" && slugs.length === 2) {
    const body = patchCategorySchema.parse(await request.json());
    const category = await updateCategory(supabase, categoryId, body);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "tutorial_category.updated",
      targetType: "tutorial_category",
      targetId: categoryId,
      ip: ip(request),
      metadata: { name: category.name, isActive: category.isActive },
    });
    return category;
  }

  if (method === "DELETE" && slugs.length === 2) {
    const { categories } = await listAdminCategories(supabase);
    const current = categories.find((item) => item.id === categoryId);
    await deleteCategory(supabase, categoryId);
    await writeBillingAudit(supabase, {
      actorId: ctx.userId,
      actorType: "SUPER_ADMIN",
      action: "tutorial_category.deleted",
      targetType: "tutorial_category",
      targetId: categoryId,
      ip: ip(request),
      metadata: { name: current?.name },
    });
    return { ok: true };
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
