import { jsonBody, uuidParam, type AccountantRoute } from "@/lib/api/v1/ai-accountant/shared";
import { askAiAccountant, getThread, listThreads, remainingAssistantQuota } from "@/modules/ai-accountant/assistant/run";

export async function handleAssistantRoutes({ request, admin, ctx, key, slugs }: AccountantRoute) {
  const org = ctx.organizationId;
  if (key === "GET ai-accountant/assistant/threads") {
    const [threads, quota] = await Promise.all([listThreads(admin, org), remainingAssistantQuota(admin, org)]);
    return { ...threads, quota };
  }
  if (slugs[1] === "assistant" && slugs[2] === "threads" && slugs[3] && key.startsWith("GET ")) {
    return getThread(admin, org, uuidParam(slugs[3], "Conversation id"));
  }
  if (key === "POST ai-accountant/assistant") {
    return askAiAccountant(admin, { organizationId: org, userId: ctx.userId, raw: await jsonBody(request) });
  }
  return null;
}
