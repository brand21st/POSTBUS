import type { NextRequest } from "next/server";
import { handleMerchantV1 } from "@/modules/merchant-api/handle";

const dispatch = async (request: NextRequest, context: { params: Promise<{ slug: string[] }> }) => {
  const { slug } = await context.params;
  return handleMerchantV1(request, slug ?? []);
};

export const maxDuration = 120;

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
