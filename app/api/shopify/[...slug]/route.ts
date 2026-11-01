import { apiRouteWithContext } from "@/lib/api/handler";
import { handleShopifyAppApi } from "@/lib/shopify-app/handle";

const dispatch = apiRouteWithContext<{ slug: string[] }>(async (request, context) => {
  const { slug } = await context.params;
  return handleShopifyAppApi(request, slug ?? []);
});

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;

// Booking and label PDFs reuse v1 handlers, which may run long.
export const maxDuration = 120;
