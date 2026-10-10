import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { orIlike } from "@/lib/api/filters";
import { parseTutorialVideo, TUTORIAL_VIDEO_URL_ERROR } from "@/modules/tutorials/video";
import type { adminTutorialQuerySchema, customerTutorialQuerySchema } from "@/modules/tutorials/schema";
import type { z } from "zod";

export type TutorialStatus = "draft" | "published";

export type TutorialCategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tutorials?: { count: number }[] | null;
};

export type TutorialRow = {
  id: string;
  category_id: string;
  title: string;
  slug: string;
  description: string | null;
  youtube_url: string;
  status: TutorialStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tutorial_categories?:
    | {
        id: string;
        name: string;
        slug: string;
        is_active?: boolean;
      }
    | {
        id: string;
        name: string;
        slug: string;
        is_active?: boolean;
      }[]
    | null;
};

function nestedCategory(row: TutorialRow) {
  const value = row.tutorial_categories;
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function categoryDeleteBlockReason(tutorialCount: number) {
  if (tutorialCount > 0) {
    return "Move or delete tutorials in this category first.";
  }
  return null;
}

export function requireTutorialVideo(url: string) {
  const parsed = parseTutorialVideo(url);
  if (!parsed) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, TUTORIAL_VIDEO_URL_ERROR);
  }
  return parsed;
}

function tutorialMedia(url: string) {
  const parsed = parseTutorialVideo(url);
  return {
    provider: parsed?.provider ?? "youtube",
    thumbnailUrl: parsed?.thumbnailUrl ?? "",
    embedUrl: parsed?.embedUrl ?? "",
  };
}

export function mapCategory(row: TutorialCategoryRow) {
  const count = row.tutorials?.[0]?.count;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    tutorialCount: typeof count === "number" ? count : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTutorial(row: TutorialRow, options?: { includeStatus?: boolean }) {
  const media = tutorialMedia(row.youtube_url);
  const nested = nestedCategory(row);
  const category = nested
    ? {
        id: nested.id,
        name: nested.name,
        slug: nested.slug,
        isActive: nested.is_active,
      }
    : null;
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    youtubeUrl: row.youtube_url,
    provider: media.provider,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnailUrl: media.thumbnailUrl,
    embedUrl: media.embedUrl,
    category: category
      ? options?.includeStatus
        ? category
        : { id: category.id, name: category.name, slug: category.slug }
      : null,
  };
}

export function mapPublicTutorial(row: TutorialRow) {
  const mapped = mapTutorial(row);
  return {
    id: mapped.id,
    title: mapped.title,
    slug: mapped.slug,
    description: mapped.description,
    youtubeUrl: mapped.youtubeUrl,
    provider: mapped.provider,
    thumbnailUrl: mapped.thumbnailUrl,
    embedUrl: mapped.embedUrl,
    sortOrder: mapped.sortOrder,
    createdAt: mapped.createdAt,
    category: mapped.category,
  };
}

async function uniqueSlug(
  supabase: SupabaseClient,
  table: "tutorials" | "tutorial_categories",
  base: string,
  excludeId?: string
) {
  const root = slugify(base) || "item";
  for (let i = 0; i < 30; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    let query = supabase.from(table).select("id").eq("slug", candidate);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

type CustomerQuery = z.infer<typeof customerTutorialQuerySchema>;
type AdminQuery = z.infer<typeof adminTutorialQuerySchema>;

export async function listPublicTutorials(supabase: SupabaseClient, query: CustomerQuery) {
  const from = (query.page - 1) * query.pageSize;
  let request = supabase
    .from("tutorials")
    .select(
      "id, category_id, title, slug, description, youtube_url, status, sort_order, created_at, updated_at, tutorial_categories!inner(id, name, slug, is_active)",
      { count: "exact" }
    )
    .eq("status", "published")
    .eq("tutorial_categories.is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (query.category) {
    request = request.eq("tutorial_categories.slug", query.category);
  }
  const search = query.q ? orIlike(["title", "description"], query.q) : null;
  if (search) request = request.or(search);

  const { data, error, count } = await request.range(from, from + query.pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to load tutorials.");
  return {
    items: ((data as TutorialRow[] | null) ?? []).map(mapPublicTutorial),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

export async function listPublicCategories(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("tutorial_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to load categories.");
  return { categories: ((data as TutorialCategoryRow[] | null) ?? []).map(mapCategory) };
}

export async function getPublicTutorialBySlug(supabase: SupabaseClient, slug: string) {
  const { data, error } = await supabase
    .from("tutorials")
    .select(
      "id, category_id, title, slug, description, youtube_url, status, sort_order, created_at, updated_at, tutorial_categories!inner(id, name, slug, is_active)"
    )
    .eq("slug", slug)
    .eq("status", "published")
    .eq("tutorial_categories.is_active", true)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to load this tutorial.");
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Tutorial not found.");
  return mapPublicTutorial(data as TutorialRow);
}

export async function listAdminTutorials(supabase: SupabaseClient, query: AdminQuery) {
  const from = (query.page - 1) * query.pageSize;
  let request = supabase
    .from("tutorials")
    .select(
      "id, category_id, title, slug, description, youtube_url, status, sort_order, created_at, updated_at, tutorial_categories(id, name, slug, is_active)",
      { count: "exact" }
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (query.categoryId) request = request.eq("category_id", query.categoryId);
  if (query.status && query.status !== "all") request = request.eq("status", query.status);
  const search = query.q ? orIlike(["title", "description"], query.q) : null;
  if (search) request = request.or(search);

  const { data, error, count } = await request.range(from, from + query.pageSize - 1);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to load tutorials.");
  return {
    items: ((data as TutorialRow[] | null) ?? []).map((row) => mapTutorial(row, { includeStatus: true })),
    page: query.page,
    pageSize: query.pageSize,
    total: count ?? 0,
  };
}

export async function getAdminTutorial(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("tutorials")
    .select(
      "id, category_id, title, slug, description, youtube_url, status, sort_order, created_at, updated_at, tutorial_categories(id, name, slug, is_active)"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to load this tutorial.");
  if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Tutorial not found.");
  return mapTutorial(data as TutorialRow, { includeStatus: true });
}

export async function listAdminCategories(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("tutorial_categories")
    .select("*, tutorials(count)")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to load categories.");
  return { categories: ((data as TutorialCategoryRow[] | null) ?? []).map(mapCategory) };
}

export async function createCategory(
  supabase: SupabaseClient,
  input: { name: string; description?: string | null; sortOrder?: number; isActive?: boolean }
) {
  const slug = await uniqueSlug(supabase, "tutorial_categories", input.name);
  const { data, error } = await supabase
    .from("tutorial_categories")
    .insert({
      name: input.name,
      slug,
      description: input.description ?? null,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    })
    .select("*")
    .single();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to create this category.");
  return mapCategory(data as TutorialCategoryRow);
}

export async function updateCategory(
  supabase: SupabaseClient,
  id: string,
  input: { name?: string; description?: string | null; sortOrder?: number; isActive?: boolean }
) {
  const { data: current } = await supabase.from("tutorial_categories").select("*").eq("id", id).maybeSingle();
  if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found.");
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;
  if (input.isActive !== undefined) updates.is_active = input.isActive;
  const { data, error } = await supabase.from("tutorial_categories").update(updates).eq("id", id).select("*").single();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to update this category.");
  return mapCategory(data as TutorialCategoryRow);
}

export async function deleteCategory(supabase: SupabaseClient, id: string) {
  const { data: current } = await supabase.from("tutorial_categories").select("id").eq("id", id).maybeSingle();
  if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Category not found.");
  const { count, error: countError } = await supabase
    .from("tutorials")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);
  if (countError) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to delete this category.");
  const blocked = categoryDeleteBlockReason(count ?? 0);
  if (blocked) throw new AppError(ERROR_CODES.CONFLICT, blocked);
  const { error } = await supabase.from("tutorial_categories").delete().eq("id", id);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to delete this category.");
}

export async function createTutorial(
  supabase: SupabaseClient,
  input: {
    title: string;
    youtubeUrl: string;
    categoryId: string;
    description?: string | null;
    status?: TutorialStatus;
    sortOrder?: number;
  }
) {
  requireTutorialVideo(input.youtubeUrl);
  const { data: category } = await supabase
    .from("tutorial_categories")
    .select("id")
    .eq("id", input.categoryId)
    .maybeSingle();
  if (!category) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select a valid category.");
  const slug = await uniqueSlug(supabase, "tutorials", input.title);
  const { data, error } = await supabase
    .from("tutorials")
    .insert({
      title: input.title,
      slug,
      youtube_url: input.youtubeUrl.trim(),
      category_id: input.categoryId,
      description: input.description ?? null,
      status: input.status ?? "draft",
      sort_order: input.sortOrder ?? 0,
    })
    .select(
      "id, category_id, title, slug, description, youtube_url, status, sort_order, created_at, updated_at, tutorial_categories(id, name, slug, is_active)"
    )
    .single();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to create this tutorial.");
  return mapTutorial(data as TutorialRow, { includeStatus: true });
}

export async function updateTutorial(
  supabase: SupabaseClient,
  id: string,
  input: {
    title?: string;
    youtubeUrl?: string;
    categoryId?: string;
    description?: string | null;
    status?: TutorialStatus;
    sortOrder?: number;
  }
) {
  const { data: current } = await supabase.from("tutorials").select("*").eq("id", id).maybeSingle();
  if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Tutorial not found.");
  if (input.youtubeUrl !== undefined) requireTutorialVideo(input.youtubeUrl);
  if (input.categoryId) {
    const { data: category } = await supabase
      .from("tutorial_categories")
      .select("id")
      .eq("id", input.categoryId)
      .maybeSingle();
    if (!category) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Select a valid category.");
  }
  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.youtubeUrl !== undefined) updates.youtube_url = input.youtubeUrl.trim();
  if (input.categoryId !== undefined) updates.category_id = input.categoryId;
  if (input.description !== undefined) updates.description = input.description;
  if (input.status !== undefined) updates.status = input.status;
  if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;
  const { data, error } = await supabase
    .from("tutorials")
    .update(updates)
    .eq("id", id)
    .select(
      "id, category_id, title, slug, description, youtube_url, status, sort_order, created_at, updated_at, tutorial_categories(id, name, slug, is_active)"
    )
    .single();
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to update this tutorial.");
  return mapTutorial(data as TutorialRow, { includeStatus: true });
}

export async function deleteTutorial(supabase: SupabaseClient, id: string) {
  const { data: current } = await supabase.from("tutorials").select("id").eq("id", id).maybeSingle();
  if (!current) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Tutorial not found.");
  const { error } = await supabase.from("tutorials").delete().eq("id", id);
  if (error) throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Unable to delete this tutorial.");
}
