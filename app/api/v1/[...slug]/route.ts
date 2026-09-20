import { apiRouteWithContext } from "@/lib/api/handler";
import { handleV1 } from "@/lib/api/v1/handle";

const dispatch = apiRouteWithContext<{ slug: string[] }>(async (request, context) => {
  const { slug } = await context.params;
  return handleV1(request, slug ?? []);
});

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
