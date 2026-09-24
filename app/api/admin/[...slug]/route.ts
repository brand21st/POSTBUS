import { apiRouteWithContext } from "@/lib/api/handler";
import { requirePlatformAdmin } from "@/lib/api/admin-context";
import { handleAdminRoutes } from "@/lib/api/admin/handle";

const dispatch = apiRouteWithContext<{ slug: string[] }>(async (request, context) => {
  const { slug } = await context.params;
  const ctx = await requirePlatformAdmin();
  return handleAdminRoutes(request, ctx, slug ?? [], request.method);
});

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
