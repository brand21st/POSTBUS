import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { customerTutorialQuerySchema } from "@/modules/tutorials/schema";
import {
  getPublicTutorialBySlug,
  listPublicCategories,
  listPublicTutorials,
} from "@/modules/tutorials/service";

export async function handleMerchantTutorials(
  request: NextRequest,
  supabase: SupabaseClient,
  slugs: string[],
  method: string
) {
  if (slugs[0] !== "tutorials") return null;

  if (method !== "GET") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "You cannot manage tutorials from the workspace.");
  }

  if (slugs.length === 1) {
    const parsed = customerTutorialQuerySchema.parse({
      page: request.nextUrl.searchParams.get("page") ?? undefined,
      pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
      q: request.nextUrl.searchParams.get("q") || undefined,
      category: request.nextUrl.searchParams.get("category") || undefined,
    });
    return listPublicTutorials(supabase, parsed);
  }

  if (slugs[1] === "categories" && slugs.length === 2) {
    return listPublicCategories(supabase);
  }

  if (slugs.length === 2) {
    return getPublicTutorialBySlug(supabase, slugs[1]);
  }

  throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, "Not found.");
}
